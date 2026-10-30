import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { LspClient } from "../src/lsp-client/client.js";
import { filePathToUri } from "../src/lsp-client/connection.js";
import type { LanguageServerConfig } from "../src/registry/registry.js";
import type { LspConnection } from "../src/lsp-client/connection.js";

function createMockConnection(handlers: {
  onStart?: () => void;
  onStop?: () => void;
  onRequest?: (method: string, params?: unknown) => unknown;
  onNotify?: (method: string, params?: unknown) => void;
}): LspConnection {
  return {
    start: async () => {
      handlers.onStart?.();
    },
    stop: async () => {
      handlers.onStop?.();
    },
    request: async (method, params) => handlers.onRequest?.(method, params),
    notify: (method, params) => {
      handlers.onNotify?.(method, params);
    },
    isRunning: true,
  } as unknown as LspConnection;
}

describe("LspClient (mocked connection)", () => {
  let tempDir: string;
  let rootPath: string;
  let client: LspClient;
  let notifications: Array<{ method: string; params: unknown }>;
  let originalCreateConnection: LspClient["createConnection"];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-lsp-client-"));
    rootPath = tempDir;
    writeFileSync(join(tempDir, "index.ts"), "export class Greeter {\n  greet() {}\n}\n");
    notifications = [];

    originalCreateConnection = (LspClient.prototype as unknown as { createConnection: LspClient["createConnection"] })
      .createConnection;
    (LspClient.prototype as unknown as { createConnection: () => LspConnection }).createConnection = function () {
      return createMockConnection({
        onRequest: (method) => {
          switch (method) {
            case "initialize":
              return { capabilities: {}, serverInfo: { name: "mock-lsp", version: "1.0.0" } };
            case "workspace/symbol":
              return [
                {
                  name: "Greeter",
                  kind: 5,
                  location: {
                    uri: filePathToUri(join(rootPath, "index.ts")),
                    range: {
                      start: { line: 0, character: 6 },
                      end: { line: 0, character: 13 },
                    },
                  },
                },
              ];
            case "textDocument/documentSymbol":
              return [
                {
                  name: "Greeter",
                  kind: 5,
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: 1, character: 1 },
                  },
                  selectionRange: {
                    start: { line: 0, character: 6 },
                    end: { line: 0, character: 13 },
                  },
                },
              ];
            case "textDocument/references":
              return [
                {
                  uri: filePathToUri(join(rootPath, "index.ts")),
                  range: { start: { line: 1, character: 2 }, end: { line: 1, character: 7 } },
                },
              ];
            case "textDocument/implementation":
              return [
                {
                  uri: filePathToUri(join(rootPath, "impl.ts")),
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
                },
              ];
            case "textDocument/hover":
              return { contents: { kind: "markdown", value: "**string**" } };
            case "textDocument/prepareRename":
              return {
                range: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } },
              };
            case "textDocument/rename":
              return {
                changes: {
                  [filePathToUri(join(rootPath, "index.ts"))]: [
                    {
                      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } },
                      newText: "Renamed",
                    },
                  ],
                },
              };
            case "textDocument/definition":
              return {
                uri: filePathToUri(join(rootPath, "types.ts")),
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
              };
            default:
              return null;
          }
        },
        onNotify: (method, params) => {
          notifications.push({ method, params: params ?? {} });
        },
      });
    };

    client = new LspClient({
      rootPath,
      serverConfig: {
        id: "mock",
        languageId: "typescript",
        extensions: [".ts"],
        command: "mock-lsp",
      },
      requestTimeoutMs: 5000,
    });
  });

  afterEach(async () => {
    if (originalCreateConnection) {
      (LspClient.prototype as unknown as { createConnection: typeof originalCreateConnection }).createConnection =
        originalCreateConnection;
    }
    await client.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("watches files by extension, skips ignored directories, and closes on stop", async () => {
    client = new LspClient({
      rootPath,
      serverConfig: {
        id: "mock", languageId: "typescript", extensions: [".ts"], command: "mock",
        ignoreDirectories: ["generated"],
      },
    });
    mkdirSync(join(rootPath, "src"));
    mkdirSync(join(rootPath, "src", "generated"));
    mkdirSync(join(rootPath, ".cache"));
    await client.start();
    const file = join(rootPath, "src", "watched.ts");
    writeFileSync(file, "first");
    const waitForText = async (text: string) => {
      const deadline = Date.now() + 3000;
      while (!client.getOpenDocuments().some((doc) => doc.text === text)) {
        assert.ok(Date.now() < deadline, `Watcher did not synchronize ${text}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    await waitForText("first");
    writeFileSync(file, "second");
    writeFileSync(join(rootPath, "src", "generated", "ignored.ts"), "ignored");
    writeFileSync(join(rootPath, ".cache", "ignored.ts"), "ignored");
    writeFileSync(join(rootPath, "src", "ignored.py"), "ignored");
    await waitForText("second");
    assert.equal(client.getOpenDocuments().length, 1);
    const events = notifications.filter((n) => n.method.startsWith("textDocument/"));
    assert.equal(events[0]?.method, "textDocument/didOpen");
    assert.equal(events[1]?.method, "textDocument/didChange");
    const versions = events.map((n) => (n.params as { textDocument: { version: number } }).textDocument.version);
    assert.deepEqual(versions, [1, 2, 3]);
    await client.stop();
    writeFileSync(file, "after stop");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(client.getOpenDocuments()[0]?.text, "second");
  });

  it("starts without a watcher when its root does not exist", async () => {
    client = new LspClient({
      rootPath: join(rootPath, "missing"),
      serverConfig: { id: "mock", languageId: "typescript", extensions: [".ts"], command: "mock" },
    });
    await client.start();
    assert.equal(client.serverState, "ready");
  });

  it("starts and reports ready state", async () => {
    assert.equal(client.serverState, "stopped");
    await client.start();
    assert.equal(client.serverState, "ready");
    assert.equal(client.info?.name, "mock-lsp");
    assert.deepEqual(client.getOpenDocuments(), []);
  });

  it("waits after auto-opening files before concurrent startup and workspace requests complete", async () => {
    let openedAt = 0;
    let requestedAt = 0;
    let initializeCount = 0;
    let fileOpened!: () => void;
    const opened = new Promise<void>((resolve) => { fileOpened = resolve; });
    const connection = createMockConnection({
      onRequest: (method) => {
        if (method === "initialize") {
          initializeCount++;
          return { capabilities: {} };
        }
        requestedAt = performance.now();
        return [];
      },
      onNotify: (method) => {
        if (method === "textDocument/didOpen") {
          openedAt = performance.now();
          fileOpened();
        }
      },
    });
    client = new LspClient({
      rootPath,
      serverConfig: {
        id: "mock", languageId: "typescript", extensions: [".ts"], command: "mock",
        autoOpenFiles: ["index.ts"], initSleep: 150,
      },
    });
    (client as unknown as { connection: LspConnection }).connection = connection;
    const startup = client.start();
    await opened;
    const secondStartup = client.start();
    const request = client.workspaceSymbol("x");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(client.serverState, "starting");
    assert.equal(requestedAt, 0);
    await Promise.all([startup, secondStartup, request]);
    assert.equal(initializeCount, 1);
    assert.ok(requestedAt - openedAt >= 145, `request was sent after ${requestedAt - openedAt}ms`);
    assert.equal(client.serverState, "ready");
  });

  it("does not delay startup for zero or negative initSleep", async () => {
    for (const initSleep of [0, -1]) {
      client = new LspClient({
        rootPath,
        serverConfig: { id: "mock", languageId: "typescript", extensions: [".ts"], command: "mock", initSleep },
      });
      await client.start();
      assert.equal(client.serverState, "ready");
      await client.stop();
    }
  });

  it("rejects invalid initSleep values", async () => {
    for (const initSleep of [NaN, Infinity, 1.5, 2_147_483_648]) {
      client = new LspClient({
        rootPath,
        serverConfig: { id: "mock", languageId: "typescript", extensions: [".ts"], command: "mock", initSleep },
      });
      await assert.rejects(client.start(), /initSleep must be an integer/);
      await assert.rejects(client.workspaceSymbol("x"), /initSleep must be an integer/);
      await client.stop();
    }
  });

  it("interrupts the initialization delay when stopped", async () => {
    let initialized!: () => void;
    const notified = new Promise<void>((resolve) => { initialized = resolve; });
    client = new LspClient({
      rootPath,
      serverConfig: { id: "mock", languageId: "typescript", extensions: [".ts"], command: "mock", initSleep: 60_000 },
    });
    (client as unknown as { connection: LspConnection }).connection = createMockConnection({
      onRequest: () => ({ capabilities: {} }),
      onNotify: (method) => { if (method === "initialized") initialized(); },
    });
    const startup = client.start();
    const rejected = assert.rejects(startup, /server_unavailable/);
    await notified;
    const waiting = assert.rejects(client.workspaceSymbol("x"), /server_unavailable/);
    await client.stop();
    await Promise.all([rejected, waiting]);
    assert.equal(client.serverState, "stopped");
  });

  it("applies the delay again when restarting", async () => {
    client = new LspClient({
      rootPath,
      serverConfig: { id: "mock", languageId: "typescript", extensions: [".ts"], command: "mock", initSleep: 100 },
    });
    await client.start();
    const started = performance.now();
    await client.restart();
    assert.ok(performance.now() - started >= 95);
  });

  it("synchronizes file changes observed during the initialization delay", async () => {
    let opened!: () => void;
    const notified = new Promise<void>((resolve) => { opened = resolve; });
    client = new LspClient({
      rootPath,
      serverConfig: {
        id: "mock", languageId: "typescript", extensions: [".ts"], command: "mock",
        autoOpenFiles: ["index.ts"], initSleep: 200,
      },
    });
    (client as unknown as { connection: LspConnection }).connection = createMockConnection({
      onRequest: () => ({ capabilities: {} }),
      onNotify: (method, params) => {
        notifications.push({ method, params });
        if (method === "textDocument/didOpen") opened();
      },
    });
    const startup = client.start();
    await notified;
    await new Promise((resolve) => setTimeout(resolve, 20));
    writeFileSync(join(rootPath, "index.ts"), "export const changed = true;\n");
    await startup;
    const deadline = Date.now() + 2000;
    while (!notifications.some((n) => n.method === "textDocument/didChange")) {
      assert.ok(Date.now() < deadline, "file change was not synchronized");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(client.getOpenDocuments()[0]?.text, "export const changed = true;\n");
  });

  it("opens configured files after initialization, before workspace requests", async () => {
    mkdirSync(join(rootPath, "src"));
    const second = join(rootPath, "src", "component.tsx");
    writeFileSync(second, "export const Component = () => null;\n");
    client = new LspClient({
      rootPath,
      serverConfig: {
        id: "mock", languageId: "typescript", extensions: [".ts", ".tsx"], command: "mock",
        autoOpenFiles: ["index.ts", second, "./index.ts"],
      },
    });

    await client.start();
    assert.deepEqual(notifications.map((n) => n.method), [
      "initialized", "textDocument/didOpen", "textDocument/didOpen",
    ]);
    assert.deepEqual(client.getOpenDocuments().map((doc) => ({
      uri: doc.uri, languageId: doc.languageId, version: doc.version, text: doc.text,
    })), [
      { uri: filePathToUri(join(rootPath, "index.ts")), languageId: "typescript", version: 1, text: "export class Greeter {\n  greet() {}\n}\n" },
      { uri: filePathToUri(second), languageId: "typescriptreact", version: 1, text: "export const Component = () => null;\n" },
    ]);
    assert.equal((await client.workspaceSymbol("Greeter"))[0]?.name, "Greeter");
  });

  it("reopens configured and other documents exactly once on restart", async () => {
    client = new LspClient({
      rootPath,
      serverConfig: {
        id: "mock", languageId: "typescript", extensions: [".ts"], command: "mock",
        autoOpenFiles: ["index.ts"],
      },
    });
    const other = join(rootPath, "other.ts");
    writeFileSync(other, "export const other = true;\n");
    await client.start();
    await client.didOpen(other);
    notifications.length = 0;

    await client.restart();
    assert.deepEqual(notifications.map((n) => n.method), [
      "initialized", "textDocument/didOpen", "textDocument/didOpen",
    ]);
    const reopened = notifications.slice(1).map((n) => (n.params as { textDocument: { uri: string } }).textDocument.uri);
    assert.deepEqual(reopened, [filePathToUri(join(rootPath, "index.ts")), filePathToUri(other)]);
  });

  it("reports an unreadable auto-open file and leaves the server unavailable", async () => {
    client = new LspClient({
      rootPath,
      serverConfig: {
        id: "mock", languageId: "typescript", extensions: [".ts"], command: "mock",
        autoOpenFiles: ["missing.ts"],
      },
    });
    await assert.rejects(client.start(), /Failed to auto-open.*missing\.ts/);
    assert.equal(client.serverState, "unavailable");
    await assert.rejects(client.workspaceSymbol("Greeter"), /Failed to auto-open.*missing\.ts/);
    assert.equal(notifications.filter((n) => n.method === "textDocument/didOpen").length, 0);
  });

  it("rejects empty auto-open paths", async () => {
    client = new LspClient({
      rootPath,
      serverConfig: {
        id: "mock", languageId: "typescript", extensions: [".ts"], command: "mock",
        autoOpenFiles: [""],
      },
    });
    await assert.rejects(client.start(), /autoOpenFiles must be an array of non-empty file paths/);
  });

  it("does not restart when already ready", async () => {
    await client.start();
    await client.start();
    assert.equal(client.serverState, "ready");
  });

  it("opens documents and tracks state", async () => {
    await client.start();
    const filePath = join(tempDir, "index.ts");
    await client.didOpen(filePath);

    const docs = client.getOpenDocuments();
    assert.equal(docs.length, 1);
    assert.match(docs[0]!.uri, /^file:\/\//);
    assert.ok(notifications.some((n) => n.method === "textDocument/didOpen"));
  });

  it("updates document on didChange", async () => {
    await client.start();
    const filePath = join(tempDir, "index.ts");
    await client.didOpen(filePath);
    await client.didChange(filePath, "export class Updated {}\n");

    const docs = client.getOpenDocuments();
    assert.match(docs[0]!.text, /Updated/);
    assert.ok(notifications.some((n) => n.method === "textDocument/didChange"));
  });

  it("returns workspace symbols", async () => {
    await client.start();
    const symbols = await client.workspaceSymbol("Greeter");
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]!.name, "Greeter");
  });

  it("returns document symbols with flattened hierarchy", async () => {
    await client.start();
    const symbols = await client.documentSymbol(join(tempDir, "index.ts"));
    assert.ok(symbols.length >= 1);
    assert.equal(symbols[0]!.name, "Greeter");
  });

  it("returns references for a position", async () => {
    await client.start();
    const refs = await client.references(join(tempDir, "index.ts"), 1, 2);
    assert.equal(refs.length, 1);
  });

  it("returns implementations for a position", async () => {
    await client.start();
    const impls = await client.implementation(join(tempDir, "index.ts"), 1, 2);
    assert.equal(impls.length, 1);
  });

  it("returns hover markdown content", async () => {
    await client.start();
    const hover = await client.hover(join(tempDir, "index.ts"), 0, 6);
    assert.ok(hover?.contents);
  });

  it("prepares and executes rename", async () => {
    await client.start();
    const prepared = await client.prepareRename(join(tempDir, "index.ts"), 0, 6);
    assert.ok(prepared?.range);

    const edit = await client.rename(join(tempDir, "index.ts"), 0, 6, "Renamed");
    assert.ok(edit?.changes);
  });

  it("returns definition location", async () => {
    await client.start();
    const def = await client.definition(join(tempDir, "index.ts"), 0, 6);
    assert.ok(def);
  });

  it("debounces publishDiagnostics notifications", async () => {
    await client.start();
    const uri = filePathToUri(join(tempDir, "index.ts"));

    (client as unknown as { handleDiagnostics: (p: unknown) => void }).handleDiagnostics({
      uri,
      diagnostics: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: "test",
        },
      ],
    });

    assert.equal(client.getDiagnostics(uri).length, 0);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(client.getDiagnostics(uri).length, 1);
  });

  it("collectDiagnostics resolves on publish instead of sleeping", async () => {
    await client.start();
    const file = join(tempDir, "index.ts");
    const uri = filePathToUri(file);

    const pending = client.collectDiagnostics(file, 5000);
    setTimeout(() => {
      (client as unknown as { handleDiagnostics: (p: unknown) => void }).handleDiagnostics({
        uri,
        diagnostics: [
          { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "late" },
        ],
      });
    }, 400);

    const started = Date.now();
    const diags = await pending;
    assert.equal(diags.length, 1);
    assert.ok(Date.now() - started < 2000);
  });

  it("reports a diagnostics timeout instead of returning cached results", async () => {
    await client.start();
    const file = join(tempDir, "index.ts");
    const uri = filePathToUri(file);
    (client as unknown as { handleDiagnostics: (p: unknown) => void }).handleDiagnostics({
      uri, diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "old" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await assert.rejects(client.collectDiagnostics(file, 100), /Diagnostics timed out/);
    assert.equal(client.getDiagnostics(uri)[0]?.message, "old");
  });

  it("requests full pull diagnostics with the advertised provider identifier", async () => {
    let requestParams: unknown;
    let requestTimeout: number | undefined;
    let initializeParams: unknown;
    const connection = createMockConnection({
      onRequest: (method, params) => {
        if (method === "initialize") {
          initializeParams = params;
          return { capabilities: { diagnosticProvider: { identifier: "lint" } } };
        }
        requestParams = params;
        return { kind: "full", items: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "pulled" }] };
      },
    });
    const originalRequest = connection.request.bind(connection);
    connection.request = (method, params, timeout) => {
      if (method === "textDocument/diagnostic") requestTimeout = timeout;
      return originalRequest(method, params, timeout);
    };
    (client as unknown as { connection: LspConnection }).connection = connection;
    await client.start();
    const file = join(tempDir, "index.ts");
    const diagnostics = await client.collectDiagnostics(file, 1200);
    assert.equal(diagnostics[0]?.message, "pulled");
    assert.deepEqual(client.getDiagnostics(filePathToUri(file)), diagnostics);
    assert.deepEqual(requestParams, { textDocument: { uri: filePathToUri(file) }, identifier: "lint" });
    assert.equal(requestTimeout, 1200);
    assert.deepEqual((initializeParams as { capabilities: { textDocument: { diagnostic: unknown } } }).capabilities.textDocument.diagnostic,
      { dynamicRegistration: false, relatedDocumentSupport: false });
  });

  it("rejects malformed or unchanged pull reports without a previous result", async () => {
    const connection = createMockConnection({
      onRequest: (method) => method === "initialize"
        ? { capabilities: { diagnosticProvider: {} } }
        : { kind: "unchanged", resultId: "old" },
    });
    (client as unknown as { connection: LspConnection }).connection = connection;
    await client.start();
    await assert.rejects(client.collectDiagnostics(join(tempDir, "index.ts"), 100), /Invalid document diagnostic report/);
  });

  it("rejects pull diagnostics if the document changes during the request", async () => {
    let finish!: (value: unknown) => void;
    const connection = createMockConnection({
      onRequest: (method) => method === "initialize"
        ? { capabilities: { diagnosticProvider: {} } }
        : new Promise((resolve) => { finish = resolve; }),
    });
    (client as unknown as { connection: LspConnection }).connection = connection;
    await client.start();
    const file = join(tempDir, "index.ts");
    const pending = client.collectDiagnostics(file);
    await new Promise((resolve) => setImmediate(resolve));
    await client.didChange(file, "changed");
    finish({ kind: "full", items: [] });
    await assert.rejects(pending, /Document changed/);
  });

  it("ignores older versioned publications and accepts an empty current publication", async () => {
    await client.start();
    const file = join(tempDir, "index.ts");
    const uri = filePathToUri(file);
    await client.didOpen(file);
    const pending = client.collectDiagnostics(file, 1000);
    await new Promise((resolve) => setImmediate(resolve));
    const publish = (params: unknown) =>
      (client as unknown as { handleDiagnostics: (p: unknown) => void }).handleDiagnostics(params);
    publish({ uri, version: 1, diagnostics: [{ message: "stale" }] });
    setTimeout(() => publish({ uri, version: 2, diagnostics: [] }), 200);
    assert.deepEqual(await pending, []);
  });

  it("catches a publication emitted synchronously while opening a document", async () => {
    let activeClient: LspClient;
    const connection = createMockConnection({
      onRequest: () => ({ capabilities: {} }),
      onNotify: (method, params) => {
        if (method === "textDocument/didOpen") {
          const doc = (params as { textDocument: { uri: string; version: number } }).textDocument;
          (activeClient as unknown as { handleDiagnostics: (p: unknown) => void }).handleDiagnostics({
            uri: doc.uri, version: doc.version, diagnostics: [],
          });
        }
      },
    });
    activeClient = client;
    (client as unknown as { connection: LspConnection }).connection = connection;
    await client.start();
    assert.deepEqual(await client.collectDiagnostics(join(tempDir, "index.ts"), 1000), []);
  });

  it("does not satisfy a new waiter with a publication already being debounced", async () => {
    await client.start();
    const file = join(tempDir, "index.ts");
    const uri = filePathToUri(file);
    (client as unknown as { handleDiagnostics: (p: unknown) => void }).handleDiagnostics({ uri, diagnostics: [] });
    await assert.rejects(client.collectDiagnostics(file, 250), /Diagnostics timed out/);
  });

  it("reports a stopped server while waiting for diagnostics", async () => {
    await client.start();
    const pending = client.collectDiagnostics(join(tempDir, "index.ts"), 1000);
    const rejected = assert.rejects(pending, /server_unavailable/);
    await new Promise((resolve) => setImmediate(resolve));
    await client.stop();
    await rejected;
  });

  it("throws server_unavailable when unavailable", async () => {
    await client.start();
    await client.stop();
    (client as unknown as { state: string }).state = "unavailable";

    await assert.rejects(() => client.workspaceSymbol("x"), /server_unavailable/);
  });

  it("throws server_starting when still starting", async () => {
    await client.start();
    (client as unknown as { state: string }).state = "starting";

    await assert.rejects(() => client.workspaceSymbol("x"), /server_starting/);
  });

  it("sets unavailable state after failed start", async () => {
    (LspClient.prototype as unknown as { createConnection: () => LspConnection }).createConnection = function () {
      return createMockConnection({
        onStart: () => {
          throw new Error("spawn failed");
        },
      });
    };

    const badClient = new LspClient({
      rootPath,
      serverConfig: {
        id: "bad",
        languageId: "typescript",
        extensions: [".ts"],
        command: "bad",
      },
    });

    await assert.rejects(() => badClient.start());
    assert.equal(badClient.serverState, "unavailable");
    await badClient.stop();
  });
});

describe("relativePath", () => {
  it("returns posix-style relative paths", async () => {
    const { relativePath } = await import("../src/lsp-client/client.js");
    const root = resolve("/proj");
    const uri = filePathToUri(join(root, "src", "foo.ts"));
    assert.equal(relativePath(root, uri), "src/foo.ts");
  });
});
