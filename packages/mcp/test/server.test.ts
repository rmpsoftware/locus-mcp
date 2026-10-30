import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LspClient } from "@rmpsoftware/locus-core";
import type { LspConnection } from "@rmpsoftware/locus-core";
import { createLocusServer } from "../src/server.js";

function mockConnection(): LspConnection {
  return {
    start: async () => {},
    stop: async () => {},
    request: async (method, params) => {
      if (method === "initialize") {
        return { capabilities: {}, serverInfo: { name: "mock", version: "1.0" } };
      }
      if (method === "workspace/symbol") {
        if ((params as { query: string }).query !== "Duplicate") return [];
        return ["a", "b"].map((name) => ({
          name: "Duplicate",
          kind: 12,
          location: {
            uri: `file:///proj/${name}.ts`,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          },
        }));
      }
      if (method === "textDocument/documentSymbol") return [];
      return null;
    },
    notify: () => {},
    isRunning: true,
  } as unknown as LspConnection;
}

describe("createLocusServer", () => {
  let tempDir: string;
  let client: Client;
  let transport: InMemoryTransport;
  let originalCreateConnection: LspClient["createConnection"];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-server-"));
    writeFileSync(join(tempDir, "locus.json"), JSON.stringify({ root: "." }));

    originalCreateConnection = (LspClient.prototype as unknown as { createConnection: LspClient["createConnection"] })
      .createConnection;
    (LspClient.prototype as unknown as { createConnection: () => LspConnection }).createConnection =
      function () {
        return mockConnection();
      };
  });

  afterEach(async () => {
    await client?.close();
    await transport?.close();

    if (originalCreateConnection) {
      (LspClient.prototype as unknown as { createConnection: typeof originalCreateConnection }).createConnection =
        originalCreateConnection;
    }

    rmSync(tempDir, { recursive: true, force: true });
  });

  async function connectServer() {
    const { server } = await createLocusServer(tempDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    transport = clientTransport;

    await server.connect(serverTransport);

    client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
  }

  it("registers exactly seven tools", async () => {
    await connectServer();
    const { tools } = await client.listTools();

    assert.equal(tools.length, 7);
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["diagnostics", "hover", "list_projects", "locate", "refs", "rename", "status"]);
  });

  it("dispatches locate tool and returns no_results", async () => {
    await connectServer();
    const result = await client.callTool({ name: "locate", arguments: { name: "MissingSymbol" } });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    assert.match(text, /status: no_results/);
  });

  it("returns multiple locate matches without an MCP error", async () => {
    await connectServer();
    const result = await client.callTool({ name: "locate", arguments: { name: "Duplicate" } });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    assert.equal(result.isError, false);
    assert.match(text, /status: ambiguous_symbol/);
    assert.match(text, /a\.ts/);
    assert.match(text, /b\.ts/);
  });

  it("returns error for unknown tool", async () => {
    await connectServer();
    const result = await client.callTool({ name: "nonexistent", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    assert.match(text, /Unknown tool/);
    assert.equal(result.isError, true);
  });

  it("reports invalid project and language filters as MCP tool errors", async () => {
    await connectServer();
    for (const args of [{ name: "Greeter", project: "" }, { name: "Greeter", lang: 42 }]) {
      const result = await client.callTool({ name: "locate", arguments: args });
      assert.equal(result.isError, true);
      assert.match((result.content as Array<{ text: string }>)[0]!.text, /^error:/);
    }
  });

  it("dispatches status tool successfully", async () => {
    await connectServer();
    const result = await client.callTool({ name: "status", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    assert.match(text, /status: ok/);
    assert.match(text, /typescript/);
  });
});
