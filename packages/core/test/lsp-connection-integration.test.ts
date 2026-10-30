import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LspConnection } from "../src/lsp-client/connection.js";
import { LspClient } from "../src/lsp-client/client.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const FAKE_LSP = join(FIXTURE_DIR, "fake-lsp.mjs");
const HANG_LSP = join(FIXTURE_DIR, "hang-lsp.mjs");

describe("LspConnection with fake-lsp", () => {
  let connection: LspConnection;

  afterEach(async () => {
    if (connection) {
      try {
        await connection.stop();
      } catch {
        /* ignore */
      }
    }
  });

  it("starts process and completes initialize", async () => {
    connection = new LspConnection({
      command: process.execPath,
      args: [FAKE_LSP],
      cwd: process.cwd(),
      requestTimeoutMs: 5000,
    });

    await connection.start();
    assert.equal(connection.isRunning, true);

    const result = (await connection.request("initialize", {
      processId: null,
      rootUri: "file:///proj",
      capabilities: {},
    })) as { serverInfo?: { name: string } };

    assert.equal(result.serverInfo?.name, "fake-lsp");
  });

  it("returns workspace symbols from fake server", async () => {
    connection = new LspConnection({
      command: process.execPath,
      args: [FAKE_LSP],
      cwd: process.cwd(),
      requestTimeoutMs: 5000,
    });

    await connection.start();
    const symbols = (await connection.request("workspace/symbol", { query: "Greeter" })) as Array<{
      name: string;
    }>;

    assert.ok(Array.isArray(symbols));
    assert.equal(symbols[0]?.name, "Greeter");
  });

  it("sends notifications while running", async () => {
    connection = new LspConnection({
      command: process.execPath,
      args: [FAKE_LSP],
      cwd: process.cwd(),
      requestTimeoutMs: 5000,
    });

    await connection.start();
    assert.doesNotThrow(() => connection.notify("initialized", {}));
  });

  it("rejects requests that exceed timeout", async () => {
    connection = new LspConnection({
      command: process.execPath,
      args: [HANG_LSP],
      cwd: process.cwd(),
      requestTimeoutMs: 200,
    });

    await connection.start();
    await assert.rejects(() => connection.request("initialize", {}), /timed out/);
    await connection.stop();
  });

  it("allows an individual request to use a shorter timeout", async () => {
    connection = new LspConnection({
      command: process.execPath,
      args: [HANG_LSP],
      cwd: process.cwd(),
      requestTimeoutMs: 5000,
    });
    await connection.start();
    const started = Date.now();
    await assert.rejects(() => connection.request("textDocument/diagnostic", {}, 100), /timed out/);
    assert.ok(Date.now() - started < 2000);
  });

  it("collects pull diagnostics from a real server process", async () => {
    const client = new LspClient({
      rootPath: process.cwd(),
      serverConfig: {
        id: "pull", languageId: "typescript", extensions: [".ts"],
        command: process.execPath, args: [FAKE_LSP, "pull"],
      },
    });
    try {
      const diagnostics = await client.collectDiagnostics(join(process.cwd(), "package.json"), 1000);
      assert.equal(diagnostics[0]?.message, "pull problem");
    } finally {
      await client.stop();
    }
  });

  it("tracks server-created progress without confusing overlapping request IDs", async () => {
    const client = new LspClient({
      rootPath: process.cwd(),
      serverConfig: {
        id: "progress", languageId: "typescript", extensions: [".ts"],
        command: process.execPath, args: [FAKE_LSP, "progress"],
      },
      requestTimeoutMs: 2000,
    });
    try {
      await client.start();
      assert.deepEqual(await client.workspaceSymbol("missing"), []);
      assert.deepEqual(client.progress, { observed: true, active: ["Indexing \u2026", "Loading projects"] });
      await client.workspaceSymbol("end");
      assert.deepEqual(client.progress, { observed: true, active: ["Loading projects"] });
      await client.workspaceSymbol("end-all");
      assert.deepEqual(client.progress, { observed: true, active: [] });
      await client.restart();
      assert.deepEqual(await client.workspaceSymbol("missing"), []);
      assert.equal(client.progress.active.length, 2);
    } finally {
      await client.stop();
    }
    assert.deepEqual(client.progress, { observed: false, active: [] });
  });

  it("reports a server exit during the initialization delay", async () => {
    const client = new LspClient({
      rootPath: process.cwd(),
      serverConfig: {
        id: "exiting", languageId: "typescript", extensions: [".ts"],
        command: process.execPath, args: [FAKE_LSP, "exit-on-initialized"], initSleep: 5000,
      },
    });
    try {
      await assert.rejects(client.start(), /server_unavailable/);
      assert.equal(client.serverState, "unavailable");
    } finally {
      await client.stop();
    }
  });

  it("stop clears running state", async () => {
    connection = new LspConnection({
      command: process.execPath,
      args: [FAKE_LSP],
      cwd: process.cwd(),
      requestTimeoutMs: 5000,
    });

    await connection.start();
    await connection.stop();
    assert.equal(connection.isRunning, false);
    await assert.rejects(() => connection.request("shutdown", {}), /not running/);
  });
});
