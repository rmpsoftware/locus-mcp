import { readFileSync, watch, type FSWatcher } from "node:fs";
import { extname, relative, resolve, isAbsolute } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  Diagnostic,
  DocumentState,
  FullDocumentDiagnosticReport,
  Hover,
  InitializeResult,
  Location,
  PublishDiagnosticsParams,
  ServerState,
  SymbolInformation,
  TextDocumentItem,
  WorkspaceEdit,
} from "./types.js";
import { LspConnection, filePathToUri, uriToFilePath } from "./connection.js";
import { isIgnoredDirectory } from "./file-resolver.js";
import type { LanguageServerConfig } from "../registry/registry.js";

const DIAGNOSTIC_DEBOUNCE_MS = 150;
const DIAGNOSTIC_WAIT_MS = 3000;

type PublishOutcome = "published" | "timeout" | "unavailable";
type PublishWaiter = {
  afterSequence: number;
  version?: number;
  finish: (outcome: PublishOutcome) => void;
};

export interface LspClientOptions {
  rootPath: string;
  serverConfig: LanguageServerConfig;
  requestTimeoutMs?: number;
}

export class LspClient {
  readonly id: string;
  readonly languageId: string;
  private connection: LspConnection;
  private state: ServerState = "stopped";
  private documents = new Map<string, DocumentState>();
  private diagnostics = new Map<string, Diagnostic[]>();
  private diagnosticTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private publishWaiters = new Map<string, Set<PublishWaiter>>();
  private diagnosticSequence = 0;
  private activeWork = new Map<string | number, string>();
  private progressObserved = false;
  private diagnosticProvider?: { identifier?: string };
  private textDocumentSync: { openClose: boolean; change: 0 | 1 | 2 } = { openClose: true, change: 1 };
  private restartAttempts = 0;
  private readonly maxRestarts = 3;
  private initialized = false;
  private autoOpenError?: Error;
  private startPromise?: Promise<void>;
  private startAbort?: AbortController;
  private watcher?: FSWatcher;
  private watchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private serverInfo?: { name: string; version?: string };

  constructor(private readonly options: LspClientOptions) {
    this.id = options.serverConfig.id;
    this.languageId = options.serverConfig.languageId;
    this.connection = this.createConnection();
  }

  get serverState(): ServerState {
    return this.state;
  }

  get info(): { name: string; version?: string } | undefined {
    return this.serverInfo;
  }

  get progress(): { observed: boolean; active: string[] } {
    return { observed: this.progressObserved, active: [...this.activeWork.values()] };
  }

  getDiagnostics(uri?: string): Diagnostic[] {
    if (uri) {
      return this.diagnostics.get(uri) ?? [];
    }
    const all: Diagnostic[] = [];
    for (const diags of this.diagnostics.values()) {
      all.push(...diags);
    }
    return all;
  }

  async collectDiagnostics(filePath: string, timeoutMs = DIAGNOSTIC_WAIT_MS): Promise<Diagnostic[]> {
    await this.ensureReady();
    const uri = filePath.startsWith("file:") ? filePath : filePathToUri(filePath);
    if (this.diagnosticProvider) {
      await this.didOpen(filePath);
      const version = this.documents.get(uri)?.version;
      const report = await this.connection.request<FullDocumentDiagnosticReport>("textDocument/diagnostic", {
        textDocument: { uri },
        ...(this.diagnosticProvider.identifier !== undefined ? { identifier: this.diagnosticProvider.identifier } : {}),
      }, timeoutMs);
      if (!report || report.kind !== "full" || !Array.isArray(report.items)) {
        throw new Error("Invalid document diagnostic report");
      }
      if (this.documents.get(uri)?.version !== version) {
        throw new Error("Document changed while collecting diagnostics");
      }
      const timer = this.diagnosticTimers.get(uri);
      if (timer) {
        clearTimeout(timer);
        this.diagnosticTimers.delete(uri);
      }
      this.diagnostics.set(uri, report.items);
      return report.items;
    }

    const { waiter, published } = this.waitForPublish(uri, timeoutMs);
    try {
      await this.openDocument(filePath, undefined, undefined, true, (version) => {
        waiter.version = version;
        waiter.afterSequence = this.diagnosticSequence;
      }, true);
    } catch (err) {
      waiter.finish("unavailable");
      throw err;
    }
    const outcome = await published;
    if (outcome === "timeout") throw new Error(`Diagnostics timed out for ${uri}`);
    if (outcome === "unavailable") throw new Error("server_unavailable");
    return this.getDiagnostics(uri);
  }

  private waitForPublish(uri: string, timeoutMs: number): { waiter: PublishWaiter; published: Promise<PublishOutcome> } {
    let waiter!: PublishWaiter;
    const published = new Promise<PublishOutcome>((resolveWait) => {
      const timer = setTimeout(() => waiter.finish("timeout"), timeoutMs);
      waiter = {
        afterSequence: this.diagnosticSequence,
        finish: (outcome) => {
          clearTimeout(timer);
          this.removePublishWaiter(uri, waiter);
          resolveWait(outcome);
        },
      };
      const list = this.publishWaiters.get(uri) ?? new Set<PublishWaiter>();
      list.add(waiter);
      this.publishWaiters.set(uri, list);
    });
    return { waiter, published };
  }

  private removePublishWaiter(uri: string, waiter: PublishWaiter): void {
    const list = this.publishWaiters.get(uri);
    list?.delete(waiter);
    if (list?.size === 0) this.publishWaiters.delete(uri);
  }

  private cancelPublishWaiters(): void {
    for (const list of this.publishWaiters.values()) {
      for (const waiter of list) waiter.finish("unavailable");
    }
  }

  getOpenDocuments(): DocumentState[] {
    return [...this.documents.values()];
  }

  async start(): Promise<void> {
    if (this.state === "ready") return;
    if (this.startPromise) return this.startPromise;

    this.state = "starting";
    this.autoOpenError = undefined;
    const controller = new AbortController();
    this.startAbort = controller;
    const startPromise = this.initialize(controller.signal);
    this.startPromise = startPromise;
    try {
      await startPromise;
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = undefined;
        this.startAbort = undefined;
      }
    }
  }

  private async initialize(signal: AbortSignal): Promise<void> {
    try {
      const initSleep = this.options.serverConfig.initSleep;
      if (initSleep !== undefined && (typeof initSleep !== "number" || !Number.isInteger(initSleep) || initSleep > 2_147_483_647)) {
        this.autoOpenError = new Error("initSleep must be an integer number of milliseconds no greater than 2147483647");
        throw this.autoOpenError;
      }
      await this.connection.start();
      if (signal.aborted) throw new Error("server_unavailable");
      const rootUri = filePathToUri(this.options.rootPath);

      const initResult = await this.connection.request<InitializeResult>("initialize", {
        processId: process.pid,
        rootUri,
        capabilities: {
          window: { workDoneProgress: true },
          workspace: {
            workspaceFolders: true,
            symbol: { dynamicRegistration: false },
          },
          textDocument: {
            synchronization: { dynamicRegistration: false, willSave: false, didSave: false },
            completion: { dynamicRegistration: false },
            hover: { contentFormat: ["markdown", "plaintext"] },
            references: { dynamicRegistration: false },
            documentSymbol: { dynamicRegistration: false },
            rename: { dynamicRegistration: false, prepareSupport: true },
            publishDiagnostics: { relatedInformation: false, versionSupport: true },
            diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
          },
        },
        workspaceFolders: [{ uri: rootUri, name: "workspace" }],
      });

      if (signal.aborted) throw new Error("server_unavailable");
      this.serverInfo = initResult.serverInfo;
      this.textDocumentSync = parseTextDocumentSync(initResult.capabilities.textDocumentSync);
      const provider = initResult.capabilities.diagnosticProvider;
      this.diagnosticProvider = provider && typeof provider === "object"
        ? provider as { identifier?: string }
        : undefined;
      this.connection.notify("initialized", {});
      const autoOpened = new Set<string>();
      const autoOpenFiles = this.options.serverConfig.autoOpenFiles === undefined
        ? []
        : this.options.serverConfig.autoOpenFiles;
      if (!Array.isArray(autoOpenFiles) || autoOpenFiles.some((file) => typeof file !== "string" || !file.trim())) {
        this.autoOpenError = new Error("autoOpenFiles must be an array of non-empty file paths");
        throw this.autoOpenError;
      }
      for (const file of autoOpenFiles) {
        const path = resolve(this.options.rootPath, file);
        const uri = filePathToUri(path);
        if (autoOpened.has(uri)) continue;
        let text: string;
        try {
          text = readFileSync(path, "utf8");
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          this.autoOpenError = new Error(`Failed to auto-open "${path}": ${reason}`, { cause: err });
          throw this.autoOpenError;
        }
        const existing = this.documents.get(uri);
        const item: TextDocumentItem = {
          uri,
          languageId: existing?.languageId ?? this.guessLanguageId(uri),
          version: existing?.version ?? 1,
          text,
        };
        this.documents.set(uri, item);
        if (this.textDocumentSync.openClose) this.connection.notify("textDocument/didOpen", { textDocument: item });
        autoOpened.add(uri);
      }
      for (const doc of this.documents.values()) {
        if (!autoOpened.has(doc.uri) && this.textDocumentSync.openClose) {
          this.connection.notify("textDocument/didOpen", { textDocument: doc });
        }
      }
      this.startWatcher();
      if (initSleep !== undefined && initSleep > 0) {
        try {
          await sleep(initSleep, undefined, { signal });
        } catch (err) {
          if (signal.aborted) throw new Error("server_unavailable", { cause: err });
          throw err;
        }
      }
      if (signal.aborted) throw new Error("server_unavailable");
      this.initialized = true;
      this.state = "ready";
      this.restartAttempts = 0;
    } catch (err) {
      this.state = "unavailable";
      this.initialized = false;
      this.stopWatcher();
      await this.connection.stop();
      throw err;
    }
  }

  async stop(): Promise<void> {
    const startPromise = this.startPromise;
    this.startAbort?.abort();
    this.stopWatcher();
    for (const timer of this.diagnosticTimers.values()) {
      clearTimeout(timer);
    }
    this.diagnosticTimers.clear();
    this.cancelPublishWaiters();
    this.activeWork.clear();
    this.progressObserved = false;
    await this.connection.stop();
    if (startPromise) {
      try {
        await startPromise;
      } catch {
        // Stopping deliberately interrupts a pending startup.
      }
    }
    this.state = "stopped";
    this.initialized = false;
    this.autoOpenError = undefined;
    this.diagnosticProvider = undefined;
  }

  async restart(): Promise<void> {
    if (this.restartAttempts >= this.maxRestarts) {
      this.state = "unavailable";
      throw new Error("Maximum LSP restart attempts exceeded");
    }
    this.restartAttempts++;
    await this.stop();
    this.connection = this.createConnection();
    await this.start();
  }

  async didOpen(filePath: string, languageId?: string, text?: string, bumpVersion = true): Promise<void> {
    return this.openDocument(filePath, languageId, text, bumpVersion);
  }

  private async openDocument(
    filePath: string,
    languageId?: string,
    text?: string,
    bumpVersion = true,
    onVersion?: (version: number) => void,
    forceChange = false,
  ): Promise<void> {
    await this.ensureReady();

    const uri = filePath.startsWith("file:") ? filePath : filePathToUri(filePath);
    const content = text ?? readFileSync(uriToFilePath(uri), "utf8");
    const lang = languageId ?? this.guessLanguageId(uri);

    const existing = this.documents.get(uri);
    if (existing && existing.text === content && !forceChange) {
      onVersion?.(existing.version);
      return;
    }
    const version = existing ? existing.version + 1 : 1;

    const item: TextDocumentItem = { uri, languageId: lang, version, text: content };
    if (existing && !bumpVersion) {
      throw new Error(`Cannot update changed document without a version bump: ${uri}`);
    }
    if (text !== undefined && !this.textDocumentSync.openClose && this.textDocumentSync.change === 0 &&
        text !== readFileSync(uriToFilePath(uri), "utf8")) {
      throw new Error(`Language server does not support synchronizing unsaved changes: ${uri}`);
    }
    this.documents.set(uri, item);
    onVersion?.(version);
    if (!existing) {
      if (this.textDocumentSync.openClose) this.connection.notify("textDocument/didOpen", { textDocument: item });
    } else if (this.textDocumentSync.change === 0 && this.textDocumentSync.openClose) {
      this.connection.notify("textDocument/didClose", { textDocument: { uri } });
      this.connection.notify("textDocument/didOpen", { textDocument: item });
    } else if (this.textDocumentSync.change !== 0) {
      this.connection.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [this.textDocumentSync.change === 2
          ? { range: fullTextRange(existing.text), text: content }
          : { text: content }],
      });
    }
  }

  async didChange(filePath: string, text: string): Promise<void> {
    return this.openDocument(filePath, undefined, text);
  }

  async workspaceSymbol(query: string): Promise<SymbolInformation[]> {
    await this.ensureReady();
    const result = await this.connection.request<SymbolInformation[] | null>("workspace/symbol", { query });
    return result ?? [];
  }

  async documentSymbol(filePath: string): Promise<SymbolInformation[]> {
    await this.ensureReady();
    const uri = filePath.startsWith("file:") ? filePath : filePathToUri(filePath);
    await this.didOpen(uriToFilePath(uri));

    const symbols = await this.connection.request<
      import("./types.js").DocumentSymbol[] | SymbolInformation[] | null
    >("textDocument/documentSymbol", { textDocument: { uri } });

    if (!symbols) return [];

    if (symbols.length > 0 && "location" in symbols[0]!) {
      return symbols as SymbolInformation[];
    }

    return flattenDocumentSymbols(symbols as import("./types.js").DocumentSymbol[], uri);
  }

  async references(filePath: string, line: number, character: number, includeDeclaration = true): Promise<Location[]> {
    await this.ensureReady();
    const uri = filePath.startsWith("file:") ? filePath : filePathToUri(filePath);
    await this.didOpen(uriToFilePath(uri));

    const result = await this.connection.request<Location[] | null>("textDocument/references", {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration },
    });
    return result ?? [];
  }

  async implementation(filePath: string, line: number, character: number): Promise<Location[]> {
    await this.ensureReady();
    const uri = filePath.startsWith("file:") ? filePath : filePathToUri(filePath);
    await this.didOpen(uriToFilePath(uri));

    const result = await this.connection.request<Location[] | null>("textDocument/implementation", {
      textDocument: { uri },
      position: { line, character },
    });
    return result ?? [];
  }

  async hover(filePath: string, line: number, character: number): Promise<Hover | null> {
    await this.ensureReady();
    const uri = filePath.startsWith("file:") ? filePath : filePathToUri(filePath);
    await this.didOpen(uriToFilePath(uri));

    return this.connection.request<Hover | null>("textDocument/hover", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async prepareRename(filePath: string, line: number, character: number): Promise<{ range: import("./types.js").Range } | null> {
    await this.ensureReady();
    const uri = filePath.startsWith("file:") ? filePath : filePathToUri(filePath);
    await this.didOpen(uriToFilePath(uri));

    try {
      return await this.connection.request("textDocument/prepareRename", {
        textDocument: { uri },
        position: { line, character },
      });
    } catch {
      return null;
    }
  }

  async rename(filePath: string, line: number, character: number, newName: string): Promise<WorkspaceEdit | null> {
    await this.ensureReady();
    const uri = filePath.startsWith("file:") ? filePath : filePathToUri(filePath);
    await this.didOpen(uriToFilePath(uri));

    return this.connection.request<WorkspaceEdit | null>("textDocument/rename", {
      textDocument: { uri },
      position: { line, character },
      newName,
    });
  }

  async definition(filePath: string, line: number, character: number): Promise<Location | Location[] | null> {
    await this.ensureReady();
    const uri = filePath.startsWith("file:") ? filePath : filePathToUri(filePath);
    await this.didOpen(uriToFilePath(uri));

    return this.connection.request("textDocument/definition", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  private createConnection(): LspConnection {
    const { command, args, env } = this.options.serverConfig;
    return new LspConnection(
      {
        command,
        args,
        cwd: this.options.rootPath,
        env,
        requestTimeoutMs: this.options.requestTimeoutMs,
      },
      {
        onNotification: (method, params) => {
          if (method === "textDocument/publishDiagnostics") {
            this.handleDiagnostics(params as PublishDiagnosticsParams);
          } else if (method === "$/progress") {
            this.handleProgress(params);
          }
        },
        onExit: () => {
          this.activeWork.clear();
          this.progressObserved = false;
          if (this.state === "ready" || this.state === "starting") {
            this.startAbort?.abort();
            this.stopWatcher();
            this.cancelPublishWaiters();
            this.state = "unavailable";
          }
        },
      },
    );
  }

  private handleProgress(params: unknown): void {
    if (!params || typeof params !== "object" || !("token" in params) || !("value" in params)) return;
    const { token, value } = params;
    if ((typeof token !== "string" && typeof token !== "number") || !value || typeof value !== "object" || !("kind" in value)) return;
    if (value.kind === "begin" && "title" in value && typeof value.title === "string") {
      this.progressObserved = true;
      this.activeWork.set(token, value.title.replace(/\s+/g, " ").trim().slice(0, 200) || "(untitled)");
    } else if (value.kind === "end" && this.activeWork.has(token)) {
      this.activeWork.delete(token);
    }
  }

  private startWatcher(): void {
    if (this.watcher) return;
    const { extensions, ignoreDirectories } = this.options.serverConfig;
    try {
      this.watcher = watch(this.options.rootPath, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const filePath = resolve(this.options.rootPath, filename);
        const path = relative(this.options.rootPath, filePath).replace(/\\/g, "/");
        if (path === ".." || path.startsWith("../") || isAbsolute(path)) return;
        if (!extensions.includes(extname(filePath))) return;
        if (path.split("/").slice(0, -1).some((dir) => isIgnoredDirectory(dir, ignoreDirectories))) return;
        const previous = this.watchTimers.get(filePath);
        if (previous) clearTimeout(previous);
        this.watchTimers.set(filePath, setTimeout(() => {
          this.watchTimers.delete(filePath);
          void this.syncWatchedFile(filePath).catch(() => {
            // Files may disappear or become unreadable between the event and read.
          });
        }, 50));
      });
    } catch {
      // A server can run without a watcher, for example when its root does not exist.
      return;
    }
    this.watcher.on("error", () => this.stopWatcher());
    this.watcher.unref();
  }

  private stopWatcher(): void {
    this.watcher?.close();
    this.watcher = undefined;
    for (const timer of this.watchTimers.values()) clearTimeout(timer);
    this.watchTimers.clear();
  }

  private async syncWatchedFile(filePath: string): Promise<void> {
    if (this.state === "starting") await this.ensureReady();
    if (this.state !== "ready") return;
    const text = readFileSync(filePath, "utf8");
    const uri = filePathToUri(filePath);
    const existing = this.documents.get(uri);
    if (existing?.text === text) return;
    await this.didOpen(filePath, undefined, text);
  }

  private handleDiagnostics(params: PublishDiagnosticsParams): void {
    const sequence = ++this.diagnosticSequence;
    const currentVersion = this.documents.get(params.uri)?.version;
    if (params.version != null && currentVersion !== undefined && params.version < currentVersion) return;
    const existing = this.diagnosticTimers.get(params.uri);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      const latestVersion = this.documents.get(params.uri)?.version;
      if (params.version != null && latestVersion !== undefined && params.version < latestVersion) {
        this.diagnosticTimers.delete(params.uri);
        return;
      }
      this.diagnostics.set(params.uri, params.diagnostics);
      this.diagnosticTimers.delete(params.uri);
      for (const waiter of this.publishWaiters.get(params.uri) ?? []) {
        if (waiter.version !== undefined && sequence > waiter.afterSequence &&
          (params.version == null || params.version >= waiter.version)) {
          waiter.finish("published");
        }
      }
    }, DIAGNOSTIC_DEBOUNCE_MS);

    this.diagnosticTimers.set(params.uri, timer);
  }

  private async ensureReady(): Promise<void> {
    if (this.state === "starting") {
      if (this.startPromise) return this.startPromise;
      throw new Error("server_starting");
    }
    if (this.state === "unavailable") {
      if (this.autoOpenError) throw this.autoOpenError;
      throw new Error("server_unavailable");
    }
    if (!this.initialized) {
      await this.start();
    }
  }

  private guessLanguageId(uri: string): string {
    const ext = extname(uriToFilePath(uri)).toLowerCase();
    const map: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "typescriptreact",
      ".js": "javascript",
      ".jsx": "javascriptreact",
      ".py": "python",
      ".go": "go",
      ".rs": "rust",
    };
    return map[ext] ?? this.languageId;
  }
}

function parseTextDocumentSync(value: unknown): { openClose: boolean; change: 0 | 1 | 2 } {
  if (value === undefined) return { openClose: true, change: 1 };
  if (value === 0 || value === 1 || value === 2) return { openClose: value !== 0, change: value };
  if (value && typeof value === "object") {
    const sync = value as { openClose?: unknown; change?: unknown };
    if (sync.change === undefined || sync.change === 0 || sync.change === 1 || sync.change === 2) {
      return { openClose: sync.openClose === true, change: sync.change ?? 0 };
    }
  }
  throw new Error("Invalid textDocumentSync capability");
}

function fullTextRange(text: string): import("./types.js").Range {
  const lines = text.split(/\r\n|\r|\n/);
  return {
    start: { line: 0, character: 0 },
    end: { line: lines.length - 1, character: lines[lines.length - 1]!.length },
  };
}

function flattenDocumentSymbols(
  symbols: import("./types.js").DocumentSymbol[],
  uri: string,
  containerName?: string,
): SymbolInformation[] {
  const result: SymbolInformation[] = [];

  for (const symbol of symbols) {
    const qualified = containerName ? `${containerName}.${symbol.name}` : symbol.name;
    result.push({
      name: qualified,
      kind: symbol.kind,
      location: { uri, range: symbol.selectionRange },
      containerName,
    });

    if (symbol.children?.length) {
      result.push(...flattenDocumentSymbols(symbol.children, uri, qualified));
    }
  }

  return result;
}

export function relativePath(rootPath: string, uri: string): string {
  return relative(rootPath, uriToFilePath(uri)).replace(/\\/g, "/");
}
