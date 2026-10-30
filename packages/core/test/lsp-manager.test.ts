import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LspManager } from "../src/lsp-client/manager.js";
import { LspClient } from "../src/lsp-client/client.js";
import type { LanguageServerConfig } from "../src/registry/registry.js";
import type { LspConnection } from "../src/lsp-client/connection.js";

function testConfigs(): LanguageServerConfig[] {
  return [
    {
      id: "fake-ts",
      languageId: "typescript",
      extensions: [".ts", ".tsx"],
      command: "node",
      args: ["fake-lsp.mjs"],
    },
    {
      id: "missing",
      languageId: "ruby",
      extensions: [".rb"],
      command: "nonexistent-ruby-lsp-xyz",
    },
  ];
}

function mockConnection(): LspConnection {
  return {
    start: async () => {},
    stop: async () => {},
    request: async (method) => {
      if (method === "initialize") {
        return { capabilities: {}, serverInfo: { name: "mock", version: "1.0" } };
      }
      return null;
    },
    notify: () => {},
    isRunning: true,
  } as unknown as LspConnection;
}

describe("LspManager", () => {
  let tempDir: string;
  let manager: LspManager;
  let originalCreateConnection: LspClient["createConnection"];

  afterEach(async () => {
    if (originalCreateConnection) {
      (LspClient.prototype as unknown as { createConnection: typeof originalCreateConnection }).createConnection =
        originalCreateConnection;
    }
    await manager?.stopAll();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("resolves config by extension and file path", () => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
    manager = new LspManager(tempDir, testConfigs());

    assert.deepEqual(manager.configsForExtension("ts").map((c) => c.id), ["fake-ts"]);
    assert.deepEqual(manager.configsForFile("src/app.ts").map((c) => c.languageId), ["typescript"]);
    assert.deepEqual(manager.configsForFile("Gemfile"), []);
  });

  it("preserves independent server roots", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
    const configs = testConfigs();
    configs[0]!.root = "frontend";
    configs[1]!.root = "backend";
    manager = new LspManager(tempDir, configs);
    originalCreateConnection = (LspClient.prototype as any).createConnection;
    const roots: string[] = [];
    (LspClient.prototype as any).createConnection = function () {
      roots.push(this.options.rootPath);
      return mockConnection();
    };
    await manager.warm();
    assert.deepEqual(roots, [join(tempDir, "frontend"), join(tempDir, "backend")]);
  });

  it("resolves auto-open paths relative to the server root and exposes startup errors", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
    const frontend = join(tempDir, "frontend");
    mkdirSync(frontend);
    writeFileSync(join(frontend, "main.ts"), "export const app = true;\n");
    const configs = testConfigs();
    configs[0]!.root = "frontend";
    configs[0]!.autoOpenFiles = ["main.ts"];
    configs[1]!.autoOpenFiles = ["missing.rb"];
    manager = new LspManager(tempDir, configs);
    originalCreateConnection = (LspClient.prototype as unknown as { createConnection: LspClient["createConnection"] })
      .createConnection;
    (LspClient.prototype as unknown as { createConnection: () => LspConnection }).createConnection = mockConnection;

    const clients = await manager.getAllClients();
    assert.equal(clients[0]?.getOpenDocuments()[0]?.text, "export const app = true;\n");
    assert.equal(clients[1]?.serverState, "unavailable");
    await assert.rejects(clients[1]!.workspaceSymbol("app"), /Failed to auto-open.*missing\.rb/);
  });

  it("creates and starts client for matching file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
    manager = new LspManager(tempDir, testConfigs());

    originalCreateConnection = (LspClient.prototype as unknown as { createConnection: LspClient["createConnection"] })
      .createConnection;
    (LspClient.prototype as unknown as { createConnection: () => LspConnection }).createConnection =
      function () {
        return mockConnection();
      };

    const clients = await manager.getClientsForFile("index.ts");
    assert.equal(clients.length, 1);
    assert.equal(clients[0]!.serverState, "ready");
  });

  it("waits for startup when a concurrent request selects a starting server", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
    const config = testConfigs()[0]!;
    config.initSleep = 150;
    manager = new LspManager(tempDir, [config]);
    originalCreateConnection = (LspClient.prototype as unknown as { createConnection: LspClient["createConnection"] })
      .createConnection;
    let notified!: () => void;
    const initialized = new Promise<void>((resolve) => { notified = resolve; });
    (LspClient.prototype as unknown as { createConnection: () => LspConnection }).createConnection = () => ({
      ...mockConnection(),
      notify: (method: string) => { if (method === "initialized") notified(); },
    } as LspConnection);

    const first = manager.getAllClients();
    await initialized;
    const second = await manager.getAllClients();
    let completed = false;
    const request = second[0]!.workspaceSymbol("x").then(() => { completed = true; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(completed, false);
    await Promise.all([first, request]);
  });

  it("returns client even when binary is missing", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
    manager = new LspManager(tempDir, testConfigs());

    originalCreateConnection = (LspClient.prototype as unknown as { createConnection: LspClient["createConnection"] })
      .createConnection;
    (LspClient.prototype as unknown as { createConnection: () => LspConnection }).createConnection =
      function () {
        return {
          ...mockConnection(),
          start: async () => {
            throw new Error("spawn failed");
          },
        } as unknown as LspConnection;
      };

    const clients = await manager.getClientsForFile("script.rb");
    assert.equal(clients.length, 1);
    assert.equal(clients[0]!.serverState, "unavailable");
  });

  it("warms configured language servers", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
    manager = new LspManager(tempDir, testConfigs());

    originalCreateConnection = (LspClient.prototype as unknown as { createConnection: LspClient["createConnection"] })
      .createConnection;
    (LspClient.prototype as unknown as { createConnection: () => LspConnection }).createConnection =
      function () {
        return mockConnection();
      };

    await manager.warm(["fake-ts"]);
    const statuses = await manager.status();
    const ts = statuses.find((s) => s.languageId === "typescript");
    assert.ok(ts);
    assert.equal(ts!.warmed, true);
    assert.equal(ts!.state, "ready");
  });

  it("reports binary availability in status", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
    manager = new LspManager(tempDir, testConfigs());

    const statuses = await manager.status();
    const ts = statuses.find((s) => s.languageId === "typescript");
    const ruby = statuses.find((s) => s.languageId === "ruby");

    assert.equal(ts!.binaryAvailable, true);
    assert.equal(ruby!.binaryAvailable, false);
  });

  it("stops all clients and clears warmed state", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
    manager = new LspManager(tempDir, testConfigs());

    originalCreateConnection = (LspClient.prototype as unknown as { createConnection: LspClient["createConnection"] })
      .createConnection;
    (LspClient.prototype as unknown as { createConnection: () => LspConnection }).createConnection =
      function () {
        return mockConnection();
      };

    await manager.warm(["fake-ts"]);
    await manager.stopAll();

    const statuses = await manager.status();
    for (const s of statuses) {
      assert.equal(s.state, "stopped");
      assert.equal(s.warmed, false);
    }
  });

  it("reuses existing client instance", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
    manager = new LspManager(tempDir, testConfigs());

    originalCreateConnection = (LspClient.prototype as unknown as { createConnection: LspClient["createConnection"] })
      .createConnection;
    (LspClient.prototype as unknown as { createConnection: () => LspConnection }).createConnection =
      function () {
        return mockConnection();
      };

    const [first] = await manager.getClientsForFile("a.ts");
    const [second] = await manager.getClientsForFile("b.ts");
    assert.equal(first, second);
  });

  it("returns no clients for unknown file extension", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
    manager = new LspManager(tempDir, testConfigs());

    assert.deepEqual(await manager.getClientsForFile("readme.md"), []);
  });

  describe("with several servers", () => {
    function server(id: string, root?: string): LanguageServerConfig {
      return { id, root, languageId: "typescript", extensions: [".ts"], command: "node" };
    }

    function useMockConnections(start: (id: string) => Promise<void> = async () => {}): void {
      originalCreateConnection = (LspClient.prototype as any).createConnection;
      (LspClient.prototype as any).createConnection = function () {
        return { ...mockConnection(), start: () => start(this.options.serverConfig.id) };
      };
    }

    it("returns every server for an extension in config order", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
      useMockConnections();
      manager = new LspManager(tempDir, [server("a"), server("b")]);

      const clients = await manager.getClientsForFile("src/app.ts");
      assert.deepEqual(clients.map((c) => c.id), ["a", "b"]);
      assert.ok(clients.every((c) => c.serverState === "ready"));
    });

    it("starts servers in parallel", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
      let release!: () => void;
      const bothStarting = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started = 0;
      useMockConnections(async () => {
        if (++started === 2) release();
        await bothStarting;
      });
      manager = new LspManager(tempDir, [server("a"), server("b")]);

      const clients = await manager.getClientsForFile("app.ts");
      assert.equal(clients.length, 2);
    });

    it("keeps running servers when another fails to start", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
      useMockConnections(async (id) => {
        if (id === "a") throw new Error("spawn failed");
      });
      manager = new LspManager(tempDir, [server("a"), server("b")]);

      const clients = await manager.getClientsForFile("app.ts");
      assert.deepEqual(clients.map((c) => c.serverState), ["unavailable", "ready"]);
    });

    it("scopes files to the servers whose root contains them", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
      useMockConnections();
      manager = new LspManager(tempDir, [server("frontend", "apps/web"), server("backend", "apps/api")]);

      const ids = (file: string) => manager.configsForFile(file).map((c) => c.id);
      assert.deepEqual(ids("apps/web/src/a.ts"), ["frontend"]);
      assert.deepEqual(ids(join(tempDir, "apps/api/b.ts")), ["backend"]);
      assert.deepEqual(ids("apps/web-old/c.ts"), []);
      assert.deepEqual((await manager.getClientsForFile("apps/web-old/c.ts")).map((c) => c.id), []);
    });

    it("includes unscoped servers alongside a matching root", () => {
      tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
      manager = new LspManager(tempDir, [server("linter"), server("backend", "api")]);

      const ids = (file: string) => manager.configsForFile(file).map((c) => c.id);
      assert.deepEqual(ids("api/a.ts"), ["linter", "backend"]);
      assert.deepEqual(ids("web/a.ts"), ["linter"]);
    });

    it("does not select servers for a file outside every root", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
      manager = new LspManager(tempDir, [server("a", "x"), server("b", "y")]);

      assert.deepEqual(manager.configsForFile("/elsewhere/lib.ts").map((c) => c.id), []);
      assert.deepEqual(await manager.getClientsForFile("/elsewhere/lib.ts"), []);
    });

    it("requires both a matching extension and a containing root", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
      useMockConnections();
      manager = new LspManager(tempDir, [
        server("outer"),
        server("nested", "apps/web"),
        server("other", "apps/api"),
        { ...server("wrong-extension", "apps/web"), extensions: [".py"] },
      ]);
      assert.deepEqual((await manager.getClientsForFile("apps/web/src/a.ts")).map((c) => c.id), ["outer", "nested"]);
      assert.deepEqual(await manager.getClientsForFile("apps/web/src/a.rb"), []);
    });

    it("does not return one client twice for configs sharing an id", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
      useMockConnections();
      manager = new LspManager(tempDir, [server("same"), server("same")]);

      assert.equal((await manager.getClientsForFile("a.ts")).length, 1);
    });

    it("keeps clients with the same id but different roots separate", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
      useMockConnections();
      manager = new LspManager(tempDir, [server("same", "web"), server("same", "api")]);

      const [web] = await manager.getClientsForFile("web/a.ts");
      const before = await manager.status();
      assert.deepEqual(before.map((status) => status.state), ["ready", "stopped"]);
      const [api] = await manager.getClientsForFile("api/a.ts");
      assert.ok(web);
      assert.ok(api);
      assert.notEqual(web, api);
      assert.deepEqual((await manager.status()).map((status) => status.state), ["ready", "ready"]);
    });

    it("starts all configured servers regardless of extension", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
      useMockConnections();
      manager = new LspManager(tempDir, [...testConfigs(), server("extra")]);

      assert.deepEqual((await manager.getAllClients()).map((c) => c.id), ["fake-ts", "missing", "extra"]);
    });

    it("lists only ready clients as running, without starting any", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
      useMockConnections(async (id) => {
        if (id === "a") throw new Error("spawn failed");
      });
      manager = new LspManager(tempDir, [server("a"), server("b"), { ...server("c"), extensions: [".py"] }]);

      await manager.getClientsForFile("app.ts");
      assert.deepEqual(manager.getRunningClients().map((c) => c.id), ["b"]);
    });

    it("tracks warmth per server, not per language", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
      useMockConnections(async (id) => {
        if (id === "a") throw new Error("spawn failed");
      });
      manager = new LspManager(tempDir, [server("a"), server("b")]);

      await manager.warm(["a", "b"]);
      const statuses = await manager.status();
      assert.deepEqual(statuses.map((s) => [s.id, s.warmed]), [["a", false], ["b", true]]);
    });

    it("warms only flagged server configurations, even with shared IDs", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
      useMockConnections();
      manager = new LspManager(tempDir, [
        { ...server("same", "web"), warm: true },
        { ...server("same", "api"), warm: false },
        server("other"),
      ]);

      await manager.warmConfigured();
      assert.deepEqual((await manager.status()).map((s) => s.warmed), [true, false, false]);
    });

    it("does not start any servers when none are flagged", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "locus-manager-"));
      useMockConnections();
      manager = new LspManager(tempDir, [{ ...server("a"), warm: false }, server("b")]);

      await manager.warmConfigured();
      assert.deepEqual((await manager.status()).map((s) => s.state), ["stopped", "stopped"]);
    });
  });
});
