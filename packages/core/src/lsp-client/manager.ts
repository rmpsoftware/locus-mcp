import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { LanguageServerConfig } from "../registry/registry.js";
import { BUILTIN_SERVERS } from "../registry/builtins.js";
import { LspClient } from "./client.js";
import { findFilesByName, isFile, type FileResolution } from "./file-resolver.js";
import type { ServerState } from "./types.js";

export interface ServerStatus {
  id: string;
  languageId: string;
  extensions: string[];
  command: string;
  state: ServerState;
  binaryAvailable: boolean;
  serverInfo?: { name: string; version?: string };
  openDocuments: number;
  warmed: boolean;
  progress?: { observed: boolean; active: string[] };
}

export interface ServerFilter {
  project?: string;
  lang?: string;
}

export class LspManager {
  private clients = new Map<string, LspClient>();
  private warmedServers = new Set<string>();
  private readonly rootPath: string;
  private readonly configs: LanguageServerConfig[];

  constructor(rootPath: string, configs?: LanguageServerConfig[]) {
    this.rootPath = rootPath;
    this.configs = configs ?? BUILTIN_SERVERS;
  }

  getConfigs(): LanguageServerConfig[] {
    return this.configs;
  }

  private matchingConfigs(filter: ServerFilter = {}): LanguageServerConfig[] {
    return this.configs.filter((c) =>
      (filter.project === undefined || c.id === filter.project) &&
      (filter.lang === undefined || c.languageId === filter.lang),
    );
  }

  configsForExtension(ext: string, filter: ServerFilter = {}): LanguageServerConfig[] {
    const normalized = ext.startsWith(".") ? ext : `.${ext}`;
    return this.matchingConfigs(filter).filter((c) => c.extensions.includes(normalized));
  }

  configsForFile(filePath: string, filter: ServerFilter = {}): LanguageServerConfig[] {
    const candidates = this.configsForExtension(extname(filePath), filter);
    const absolutePath = resolve(this.rootPath, filePath);
    return candidates.filter((c) => isInside(this.serverRoot(c), absolutePath));
  }

  async resolveFile(file: string, filter: ServerFilter = {}): Promise<FileResolution> {
    const candidates = await this.fileCandidates(file, filter);

    if (candidates.length === 0) {
      return { status: "file_not_found", message: `No file matching "${file}" in the project or server roots` };
    }

    if (candidates.length === 1) {
      return { status: "ok", file: candidates[0]! };
    }

    return { status: "ambiguous_file", message: `Multiple files match "${file}"`, data: candidates.join("\n") };
  }

  async getClientsForFile(filePath: string, filter: ServerFilter = {}): Promise<LspClient[]> {
    return this.startClients(this.configsForFile(filePath, filter));
  }

  async getAllClients(filter: ServerFilter = {}): Promise<LspClient[]> {
    return this.startClients(this.matchingConfigs(filter));
  }

  getRunningClients(filter: ServerFilter = {}): LspClient[] {
    return [...this.clients.values()].filter((client) =>
      client.serverState === "ready" &&
      (filter.project === undefined || client.id === filter.project) &&
      (filter.lang === undefined || client.languageId === filter.lang),
    );
  }

  async warm(ids?: string[]): Promise<void> {
    const targets = ids?.length
      ? this.configs.filter((c) => ids.includes(c.id))
      : this.configs;

    for (const config of targets) {
      try {
        await this.clientFor(config).start();
        this.warmedServers.add(this.clientKey(config));
      } catch {
        // Skip unavailable servers during warm
      }
    }
  }

  async status(): Promise<ServerStatus[]> {
    const statuses: ServerStatus[] = [];

    for (const config of this.configs) {
      const binaryAvailable = await isBinaryAvailable(config.command);
      const key = this.clientKey(config);
      const client = this.clients.get(key);

      statuses.push({
        id: config.id,
        languageId: config.languageId,
        extensions: config.extensions,
        command: config.command,
        state: client?.serverState ?? "stopped",
        binaryAvailable,
        serverInfo: client?.info,
        openDocuments: client?.getOpenDocuments().length ?? 0,
        warmed: this.warmedServers.has(key),
        progress: client?.progress,
      });
    }

    return statuses;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.clients.values()].map((client) => client.stop()));
    this.clients.clear();
    this.warmedServers.clear();
  }

  private async fileCandidates(file: string, filter: ServerFilter): Promise<string[]> {
    if (isAbsolute(file)) {
      return isFile(file) ? [resolve(file)] : [];
    }

    const fromProject = resolve(this.rootPath, file);
    const filtered = filter.project !== undefined || filter.lang !== undefined;
    if (isFile(fromProject) && (!filtered || this.configsForFile(fromProject, filter).length > 0)) {
      return [fromProject];
    }

    const configs = this.configsForExtension(extname(file), filter);
    const roots = [...new Set(configs.map((c) => this.serverRoot(c)))];
    const fromServers = roots.map((root) => resolve(root, file)).filter((path) => isFile(path));
    if (fromServers.length > 0 || /[\\/]/.test(file)) return fromServers;

    const matches = await Promise.all(
      configs.map((c) => findFilesByName(this.serverRoot(c), file, c.ignoreDirectories)),
    );
    return [...new Set(matches.flat())].sort();
  }

  private serverRoot(config: LanguageServerConfig): string {
    return resolve(this.rootPath, config.root ?? ".");
  }

  private clientKey(config: LanguageServerConfig): string {
    return JSON.stringify([config.id, this.serverRoot(config)]);
  }

  private clientFor(config: LanguageServerConfig): LspClient {
    const key = this.clientKey(config);
    let client = this.clients.get(key);
    if (!client) {
      client = new LspClient({ rootPath: this.serverRoot(config), serverConfig: config });
      this.clients.set(key, client);
    }
    return client;
  }

  private async startClients(configs: LanguageServerConfig[]): Promise<LspClient[]> {
    const clients = [...new Set(configs.map((config) => this.clientFor(config)))];

    await Promise.all(
      clients.map(async (client) => {
        if (client.serverState !== "stopped" && client.serverState !== "unavailable") return;
        try {
          await client.start();
        } catch {
          // A failed start surfaces as server_unavailable on the client's next request
        }
      }),
    );

    return clients;
  }
}

function isInside(root: string, filePath: string): boolean {
  const path = relative(root, filePath);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function isBinaryAvailable(command: string): Promise<boolean> {
  if (command.includes("/") || command.includes("\\")) {
    try {
      await access(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  const lookup = process.platform === "win32" ? "where" : "which";
  const { spawn } = await import("node:child_process");

  return new Promise((resolve) => {
    const proc = spawn(lookup, [command], { shell: true, stdio: "ignore" });
    proc.on("exit", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}
