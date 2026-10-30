import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { LspClient } from "@rmpsoftware/locus-core";
import { SymbolResolver } from "@rmpsoftware/locus-core";
import type { LocusServerContext } from "../src/context.js";
import { handleLocate } from "../src/tools/locate.js";
import { handleRefs } from "../src/tools/refs.js";
import { handleHover } from "../src/tools/hover.js";
import { handleDiagnostics } from "../src/tools/diagnostics.js";
import { handleStatus } from "../src/tools/status.js";
import { handleRename } from "../src/tools/rename.js";
import { filePathToUri } from "@rmpsoftware/locus-core";

const ROOT = resolve("/proj");

function mockClient(overrides: Partial<LspClient> = {}): LspClient {
  const base = {
    id: "ts",
    serverState: "ready",
    workspaceSymbol: async (query: string) => {
      if (query.includes("Greeter") || query === "Greeter") {
        return [
          {
            name: "Greeter",
            kind: 5,
            location: {
              uri: filePathToUri(resolve(ROOT, "src/index.ts")),
              range: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } },
            },
          },
        ];
      }
      return [];
    },
    documentSymbol: async () => [],
    references: async () => [],
    implementation: async () => [],
    hover: async () => ({ contents: "type Info" }),
    prepareRename: async () => ({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } } }),
    rename: async () => ({
      changes: {
        [filePathToUri(resolve(ROOT, "src/index.ts"))]: [
          { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, newText: "newName" },
        ],
      },
    }),
    didOpen: async () => {},
    getDiagnostics: () => [],
    getOpenDocuments: () => [],
    ...overrides,
  } as unknown as LspClient;
  const client = base as unknown as { collectDiagnostics?: unknown; getDiagnostics: () => unknown };
  client.collectDiagnostics ??= async () => client.getDiagnostics();
  return base;
}

function mockContext(clientOverrides?: Partial<LspClient>): LocusServerContext {
  return multiServerContext(mockClient(clientOverrides));
}

function multiServerContext(...clients: LspClient[]): LocusServerContext {
  return {
    rootPath: ROOT,
    configs: [{ id: "ts", languageId: "typescript", extensions: [".ts"], command: "fake-lsp" }],
    manager: {
      resolveFile: async (file: string) => ({ status: "ok", file: resolve(ROOT, file) }),
      getClientsForFile: async () => clients,
      getAllClients: async () => clients,
      getRunningClients: () => clients.filter((c) => c.serverState === "ready"),
      status: async () => [
        {
          id: "typescript",
          languageId: "typescript",
          extensions: [".ts"],
          command: "fake-lsp",
          state: "ready",
          binaryAvailable: true,
          openDocuments: 0,
          warmed: false,
        },
      ],
    } as LocusServerContext["manager"],
    resolver: new SymbolResolver({ rootPath: ROOT }),
  };
}

function resultText(result: { content: Array<{ text: string }> }): string {
  return result.content[0]!.text;
}

describe("handleLocate", () => {
  it("returns error when neither name nor file provided", async () => {
    const result = await handleLocate(mockContext(), {});
    assert.match(resultText(result), /status: error/);
    assert.equal(result.isError, true);
  });

  it("locates symbol by name", async () => {
    const result = await handleLocate(mockContext(), { name: "Greeter" });
    assert.match(resultText(result), /status: ok/);
    assert.match(resultText(result), /Greeter/);
  });

  it("opens the supplied file before searching for its symbol", async () => {
    let opened = false;
    const ctx = mockContext({
      didOpen: async (file) => { assert.equal(file, resolve(ROOT, "src/index.ts")); opened = true; },
      workspaceSymbol: async () => opened ? [{
        name: "Greeter",
        kind: 5,
        location: {
          uri: filePathToUri(resolve(ROOT, "src/index.ts")),
          range: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } },
        },
      }] : [],
    });
    const result = await handleLocate(ctx, { name: "Greeter", file: "src/index.ts" });
    assert.match(resultText(result), /status: ok/);
    assert.match(resultText(result), /Greeter/);
  });

  it("finds a file symbol when the workspace index returns no results", async () => {
    const ctx = mockContext({
      workspaceSymbol: async () => [],
      documentSymbol: async () => [{
        name: "Greeter",
        kind: 5,
        location: {
          uri: filePathToUri(resolve(ROOT, "src/index.ts")),
          range: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } },
        },
      }],
    });
    const result = await handleLocate(ctx, { name: "Greeter", file: "src/index.ts" });
    assert.match(resultText(result), /status: ok/);
    assert.match(resultText(result), /Greeter/);
  });

  it("returns multiple symbol matches without an MCP error", async () => {
    const ctx = mockContext({
      workspaceSymbol: async () => [
        {
          name: "foo",
          kind: 12,
          containerName: "A",
          location: {
            uri: filePathToUri(resolve(ROOT, "src/a.ts")),
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
          },
        },
        {
          name: "foo",
          kind: 12,
          containerName: "B",
          location: {
            uri: filePathToUri(resolve(ROOT, "src/b.ts")),
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
          },
        },
      ],
    });
    const result = await handleLocate(ctx, { name: "foo" });
    assert.match(resultText(result), /status: ambiguous_symbol/);
    assert.match(resultText(result), /src\/a\.ts.*A\.foo/);
    assert.match(resultText(result), /src\/b\.ts.*B\.foo/);
    assert.equal(result.isError, false);
  });

  it("returns document symbol overview for file only", async () => {
    const ctx = mockContext({
      documentSymbol: async () => [
        {
          name: "MyClass",
          kind: 5,
          containerName: undefined,
          location: {
            uri: filePathToUri(resolve(ROOT, "src/index.ts")),
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
          },
        },
      ],
    });

    const result = await handleLocate(ctx, { file: "src/index.ts" });
    assert.match(resultText(result), /status: ok/);
    assert.match(resultText(result), /MyClass/);
  });

  it("maps LSP errors to server_unavailable", async () => {
    const ctx = mockContext({
      workspaceSymbol: async () => {
        throw new Error("server_unavailable");
      },
    });
    const result = await handleLocate(ctx, { name: "UnknownSymbol" });
    assert.match(resultText(result), /status: server_unavailable/);
  });

  it("returns no_results when symbol not found", async () => {
    const ctx = mockContext({
      workspaceSymbol: async () => [],
    });
    const result = await handleLocate(ctx, { name: "NonExistent" });
    assert.match(resultText(result), /status: no_results/);
    assert.equal(result.isError, true);
  });

  it("maps server_starting errors", async () => {
    const ctx = mockContext({
      workspaceSymbol: async () => {
        throw new Error("server_starting");
      },
    });
    const result = await handleLocate(ctx, { name: "Foo" });
    assert.match(resultText(result), /status: server_starting/);
  });

  it("returns no_results for empty document symbols", async () => {
    const ctx = mockContext({ documentSymbol: async () => [] });
    const result = await handleLocate(ctx, { file: "src/index.ts" });
    assert.match(resultText(result), /status: no_results/);
    assert.match(resultText(result), /No symbols in document/);
  });

  it("throws on invalid zod input", async () => {
    await assert.rejects(() => handleLocate(mockContext(), { name: 123 }), /Expected string/);
  });
});

describe("handleRefs", () => {
  it("requires line/character or position", async () => {
    const result = await handleRefs(mockContext(), { file: "src/index.ts" });
    assert.match(resultText(result), /status: error/);
  });

  it("returns references with position shorthand", async () => {
    const ctx = mockContext({
      references: async () => [
        {
          uri: filePathToUri(resolve(ROOT, "src/index.ts")),
          range: { start: { line: 2, character: 4 }, end: { line: 2, character: 10 } },
        },
      ],
    });

    const result = await handleRefs(ctx, { file: "src/index.ts", position: "src/index.ts:3:5" });
    assert.match(resultText(result), /status: ok/);
    assert.match(resultText(result), /index\.ts:3:5/);
  });

  it("returns implementations when requested", async () => {
    const ctx = mockContext({
      implementation: async () => [
        {
          uri: filePathToUri(resolve(ROOT, "src/impl.ts")),
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        },
      ],
    });

    const result = await handleRefs(ctx, {
      file: "src/index.ts",
      line: 0,
      character: 0,
      implementations: true,
    });
    assert.match(resultText(result), /status: ok/);
    assert.match(resultText(result), /impl\.ts/);
  });

  it("returns no_results when references are empty", async () => {
    const ctx = mockContext({ references: async () => [] });
    const result = await handleRefs(ctx, {
      file: "src/index.ts",
      line: 0,
      character: 0,
    });
    assert.match(resultText(result), /status: no_results/);
  });

  it("maps server_starting on references", async () => {
    const ctx = mockContext({
      references: async () => {
        throw new Error("server_starting");
      },
    });
    const result = await handleRefs(ctx, {
      file: "src/index.ts",
      line: 0,
      character: 0,
    });
    assert.match(resultText(result), /status: server_starting/);
  });
});

describe("handleHover", () => {
  it("returns hover for file position", async () => {
    const result = await handleHover(mockContext(), {
      file: "src/index.ts",
      line: 0,
      character: 0,
    });
    assert.match(resultText(result), /status: ok/);
    assert.match(resultText(result), /type Info/);
  });

  it("resolves symbol by name before hover", async () => {
    const result = await handleHover(mockContext(), { name: "Greeter", file: "src/index.ts" });
    assert.match(resultText(result), /status: ok/);
  });

  it("returns error when position is missing", async () => {
    const result = await handleHover(mockContext(), { file: "src/index.ts" });
    assert.match(resultText(result), /status: error/);
    assert.match(resultText(result), /Provide file\+position/);
  });

  it("returns no_results when symbol name not found", async () => {
    const ctx = mockContext({ workspaceSymbol: async () => [] });
    const result = await handleHover(ctx, { name: "Missing", file: "src/index.ts" });
    assert.match(resultText(result), /status: no_results/);
  });
});

describe("handleDiagnostics", () => {
  it("returns file diagnostics", async () => {
    const uri = filePathToUri(resolve(ROOT, "src/index.ts"));
    const ctx = mockContext({
      getDiagnostics: () => [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: "Type error",
          severity: 1,
        },
      ],
      getOpenDocuments: () => [{ uri, languageId: "typescript", version: 1, text: "" }],
    });

    const result = await handleDiagnostics(ctx, { file: "src/index.ts" });
    assert.match(resultText(result), /status: ok/);
    assert.match(resultText(result), /Type error/);
  });

  it("returns ok when workspace has no diagnostics", async () => {
    const ctx = mockContext({ getOpenDocuments: () => [] });
    const result = await handleDiagnostics(ctx, { workspace: true });
    assert.match(resultText(result), /status: ok/);
    assert.match(resultText(result), /No workspace diagnostics/);
  });

  it("returns server_unavailable when no LSP for file", async () => {
    const ctx = mockContext();
    ctx.manager.getClientsForFile = async () => [];
    const result = await handleDiagnostics(ctx, { file: "src/unknown.xyz" });
    assert.match(resultText(result), /status: server_unavailable/);
  });
});

describe("handleStatus", () => {
  it("returns formatted server status", async () => {
    const result = await handleStatus(mockContext(), {});
    assert.match(resultText(result), /status: ok/);
    assert.match(resultText(result), /typescript/);
    assert.equal(result.isError, false);
  });
});

describe("handleRename", () => {
  it("returns dry-run preview by default", async () => {
    const result = await handleRename(mockContext(), {
      file: "src/index.ts",
      line: 0,
      character: 0,
      new_name: "Renamed",
    });
    assert.match(resultText(result), /status: ok/);
    assert.match(resultText(result), /Dry run/);
  });

  it("returns error when rename not possible", async () => {
    const ctx = mockContext({ prepareRename: async () => null });
    const result = await handleRename(ctx, {
      file: "src/index.ts",
      line: 0,
      character: 0,
      new_name: "X",
    });
    assert.match(resultText(result), /status: no_results/);
  });

  it("returns apply plan when apply=true", async () => {
    const result = await handleRename(mockContext(), {
      file: "src/index.ts",
      line: 0,
      character: 0,
      new_name: "Renamed",
      apply: true,
    });
    assert.match(resultText(result), /status: ok/);
    assert.match(resultText(result), /Rename plan generated/);
    assert.match(resultText(result), /Apply edits via host Edit tool/);
  });

  it("returns error when position is missing", async () => {
    const result = await handleRename(mockContext(), { new_name: "X" });
    assert.match(resultText(result), /status: error/);
    assert.match(resultText(result), /Provide file\+position/);
  });
});

describe("file resolution", () => {
  const absolute = resolve(ROOT, "src/resolved/Helper.ts");
  const calls = {
    locate: { handler: handleLocate, args: { file: "Helper.ts" } },
    "locate by name": { handler: handleLocate, args: { name: "Greeter", file: "Helper.ts" } },
    refs: { handler: handleRefs, args: { file: "Helper.ts", line: 0, character: 0 } },
    hover: { handler: handleHover, args: { file: "Helper.ts", line: 0, character: 0 } },
    "hover by name": { handler: handleHover, args: { name: "Greeter", file: "Helper.ts" } },
    diagnostics: { handler: handleDiagnostics, args: { file: "Helper.ts" } },
    rename: { handler: handleRename, args: { file: "Helper.ts", line: 0, character: 0, new_name: "x" } },
  };

  for (const [name, { handler, args }] of Object.entries(calls)) {
    it(`${name} reports a missing file`, async () => {
      const ctx = mockContext();
      ctx.manager.resolveFile = async () => ({ status: "file_not_found", message: "No file matching" });

      const result = await handler(ctx, args);
      assert.match(resultText(result), /^status: file_not_found\nNo file matching/);
      assert.equal(result.isError, true);
    });

    it(`${name} lists candidates for an ambiguous file`, async () => {
      const ctx = mockContext();
      ctx.manager.resolveFile = async () => ({
        status: "ambiguous_file",
        message: "Multiple files match",
        data: "/proj/a/Helper.ts\n/proj/b/Helper.ts",
      });

      const result = await handler(ctx, args);
      assert.match(resultText(result), /^status: ambiguous_file\nMultiple files match\n\n\/proj\/a\/Helper\.ts\n\/proj\/b\/Helper\.ts$/);
      assert.equal(result.isError, true);
    });
  }

  it("selects clients and sends requests with the resolved path", async () => {
    const seen: string[] = [];
    const record = (file: string) => {
      seen.push(file);
    };
    const client = mockClient({
      documentSymbol: async (file) => (record(file), []),
      references: async (file) => (record(file), []),
      hover: async (file) => (record(file), null),
      prepareRename: async (file) => (record(file), null),
      collectDiagnostics: async (file) => (record(file), []),
    });
    const ctx = multiServerContext(client);
    ctx.manager.resolveFile = async () => ({ status: "ok", file: absolute });
    ctx.manager.getClientsForFile = async (file) => (record(file), [client]);

    await handleLocate(ctx, { file: "Helper.ts" });
    await handleRefs(ctx, { file: "Helper.ts", line: 0, character: 0 });
    await handleHover(ctx, { file: "Helper.ts", line: 0, character: 0 });
    await handleRename(ctx, { file: "Helper.ts", line: 0, character: 0, new_name: "x" });
    await handleDiagnostics(ctx, { file: "Helper.ts" });

    assert.ok(seen.length >= 10);
    assert.ok(seen.every((file) => file === absolute), `unresolved path in ${seen.join(", ")}`);
  });

  it("resolves the file inside a position shorthand", async () => {
    const requested: string[] = [];
    const ctx = mockContext();
    ctx.manager.resolveFile = async (file) => {
      requested.push(file);
      return { status: "ok", file: absolute };
    };

    await handleRefs(ctx, { file: "ignored.ts", position: "Helper.ts:1:1" });
    await handleHover(ctx, { position: "Helper.ts:1:1" });
    await handleRename(ctx, { position: "Helper.ts:1:1", new_name: "x" });

    assert.deepEqual(requested, ["Helper.ts", "Helper.ts", "Helper.ts"]);
  });

  it("does not resolve a symbol's own path after hover finds it by name", async () => {
    const requested: string[] = [];
    const hovered: string[] = [];
    const ctx = mockContext({
      hover: async (file) => {
        hovered.push(file);
        return null;
      },
    });
    ctx.manager.resolveFile = async (file) => {
      requested.push(file);
      return { status: "ok", file: absolute };
    };

    await handleHover(ctx, { name: "Greeter", file: "Helper.ts" });

    assert.deepEqual(requested, ["Helper.ts"]);
    assert.deepEqual(hovered, [resolve(ROOT, "src/index.ts")]);
  });

  it("does not search for a file when the position is missing", async () => {
    const ctx = mockContext();
    ctx.manager.resolveFile = async () => assert.fail("should not resolve");

    assert.match(resultText(await handleRefs(ctx, { file: "Helper.ts" })), /status: error/);
    assert.match(resultText(await handleRename(ctx, { file: "Helper.ts", new_name: "x" })), /status: error/);
  });
});

describe("multiple servers", () => {
  const uri = filePathToUri(resolve(ROOT, "src/index.ts"));
  const range = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 3 } });
  const down = async () => {
    throw new Error("server_unavailable");
  };
  const position = { file: "src/index.ts", line: 0, character: 0 };

  it("sends locate without a file to every server", async () => {
    const symbol = (name: string, file: string) => ({
      name,
      kind: 12,
      location: { uri: filePathToUri(resolve(ROOT, file)), range: range(0) },
    });
    const ctx = multiServerContext(
      mockClient({ id: "ts", workspaceSymbol: async () => [symbol("run", "src/a.ts")] }),
      mockClient({ id: "py", workspaceSymbol: async () => [symbol("run", "src/b.py")] }),
    );

    const result = await handleLocate(ctx, { name: "run" });
    const text = resultText(result);
    assert.match(text, /status: ambiguous_symbol/);
    assert.match(text, /src\/a\.ts/);
    assert.match(text, /src\/b\.py/);
    assert.equal(result.isError, false);
  });

  it("merges document symbols across servers", async () => {
    const symbol = (name: string, line: number) => ({ name, kind: 5, location: { uri, range: range(line) } });
    const ctx = multiServerContext(
      mockClient({ documentSymbol: async () => [symbol("A", 0), symbol("B", 1)] }),
      mockClient({ documentSymbol: async () => [symbol("B", 1), symbol("C", 2)] }),
    );

    const text = resultText(await handleLocate(ctx, { file: "src/index.ts" }));
    assert.match(text, /3 symbol\(s\)/);
  });

  it("merges references and drops duplicates", async () => {
    const ctx = multiServerContext(
      mockClient({ references: async () => [{ uri, range: range(1) }, { uri, range: range(2) }] }),
      mockClient({ references: async () => [{ uri, range: range(2) }, { uri, range: range(3) }] }),
    );

    const text = resultText(await handleRefs(ctx, position));
    assert.match(text, /3 result\(s\)/);
    assert.match(text, /index\.ts:2:1/);
    assert.match(text, /index\.ts:3:1/);
    assert.match(text, /index\.ts:4:1/);
  });

  it("applies the limit to the merged references", async () => {
    const ctx = multiServerContext(
      mockClient({ references: async () => [{ uri, range: range(1) }] }),
      mockClient({ references: async () => [{ uri, range: range(2) }] }),
    );

    const text = resultText(await handleRefs(ctx, { ...position, limit: 1 }));
    assert.match(text, /2 result\(s\)/);
    assert.match(text, /1 more/);
  });

  it("returns partial results with an ok status when one server fails", async () => {
    const ctx = multiServerContext(
      mockClient({ id: "broken", references: down }),
      mockClient({ id: "working", references: async () => [{ uri, range: range(1) }] }),
    );

    const result = await handleRefs(ctx, position);
    assert.match(resultText(result), /status: ok/);
    assert.match(resultText(result), /1 result\(s\)/);
    assert.match(resultText(result), /broken failed \(server_unavailable\)/);
    assert.equal(result.isError, false);
  });

  it("keeps no_results when the servers that answered found nothing, naming the failure", async () => {
    const ctx = multiServerContext(mockClient({ id: "broken", references: down }), mockClient({ references: async () => [] }));

    const text = resultText(await handleRefs(ctx, position));
    assert.match(text, /status: no_results/);
    assert.match(text, /broken failed/);
  });

  it("reports a failure status only when every server failed", async () => {
    const ctx = multiServerContext(
      mockClient({ id: "a", hover: down, workspaceSymbol: down, documentSymbol: down, references: down, prepareRename: down }),
      mockClient({ id: "b", hover: down, workspaceSymbol: down, documentSymbol: down, references: down, prepareRename: down }),
    );

    const results = await Promise.all([
      handleHover(ctx, position),
      handleLocate(ctx, { name: "Foo" }),
      handleLocate(ctx, { file: "src/index.ts" }),
      handleRefs(ctx, position),
      handleRename(ctx, { ...position, new_name: "x" }),
    ]);

    for (const result of results) {
      assert.match(resultText(result), /status: server_unavailable/);
      assert.match(resultText(result), /a failed/);
      assert.match(resultText(result), /b failed/);
      assert.equal(result.isError, true);
    }
  });

  it("labels hover answers by server when they differ", async () => {
    const ctx = multiServerContext(
      mockClient({ id: "ts", hover: async () => ({ contents: "from ts" }) }),
      mockClient({ id: "lint", hover: async () => ({ contents: "from lint" }) }),
    );

    const text = resultText(await handleHover(ctx, position));
    assert.match(text, /## ts\n\nfrom ts/);
    assert.match(text, /## lint\n\nfrom lint/);
  });

  it("omits servers without a hover answer", async () => {
    const ctx = multiServerContext(mockClient({ hover: async () => null }), mockClient({ id: "lint", hover: async () => ({ contents: "only" }) }));

    const text = resultText(await handleHover(ctx, position));
    assert.doesNotMatch(text, /##/);
    assert.match(text, /only/);
  });

  it("resolves hover by name across all servers for the file", async () => {
    const ctx = multiServerContext(
      mockClient({ id: "broken", workspaceSymbol: down }),
      mockClient({ id: "working" }),
    );

    const text = resultText(await handleHover(ctx, { name: "Greeter", file: "src/index.ts" }));
    assert.match(text, /status: ok/);
    assert.match(text, /type Info/);
  });

  it("collects file diagnostics from servers concurrently", { timeout: 2000 }, async () => {
    const diagnostic = (message: string) => ({ range: range(0), message, severity: 1 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started = 0;
    const collect = (message: string) => async () => {
      if (++started === 2) release();
      await gate;
      return [diagnostic("shared"), diagnostic(message)];
    };
    const ctx = multiServerContext(
      mockClient({ collectDiagnostics: collect("from ts") }),
      mockClient({ collectDiagnostics: collect("from lint") }),
    );

    const text = resultText(await handleDiagnostics(ctx, { file: "src/index.ts" }));
    assert.match(text, /3 diagnostic\(s\)/);
    assert.match(text, /from ts/);
    assert.match(text, /from lint/);
  });

  it("reports the failure when one server cannot open the file for diagnostics", async () => {
    const ctx = multiServerContext(
      mockClient({ id: "broken", collectDiagnostics: down }),
      mockClient({ getDiagnostics: () => [{ range: range(0), message: "real", severity: 1 }] }),
    );

    const text = resultText(await handleDiagnostics(ctx, { file: "src/index.ts" }));
    assert.match(text, /status: ok/);
    assert.match(text, /real/);
    assert.match(text, /broken failed/);
  });

  it("reports diagnostics timeouts instead of claiming no diagnostics", async () => {
    const timeout = async () => { throw new Error("Diagnostics timed out"); };
    const result = await handleDiagnostics(mockContext({ collectDiagnostics: timeout }), { file: "src/index.ts" });
    assert.equal(result.isError, true);
    assert.match(resultText(result), /status: server_starting/);
    assert.match(resultText(result), /Diagnostics timed out/);
    assert.doesNotMatch(resultText(result), /No diagnostics/);
  });

  it("reports a timed out server alongside results from another server", async () => {
    const timeout = async () => { throw new Error("Diagnostics timed out"); };
    const ctx = multiServerContext(
      mockClient({ id: "slow", collectDiagnostics: timeout }),
      mockClient({ collectDiagnostics: async () => [] }),
    );
    const text = resultText(await handleDiagnostics(ctx, { file: "src/index.ts" }));
    assert.match(text, /slow failed.*Diagnostics timed out/);
  });

  it("combines workspace diagnostics for a document open in two servers", async () => {
    const doc = { uri, languageId: "typescript", version: 1, text: "" };
    const ctx = multiServerContext(
      mockClient({ getOpenDocuments: () => [doc], getDiagnostics: () => [{ range: range(0), message: "first", severity: 1 }] }),
      mockClient({ getOpenDocuments: () => [doc], getDiagnostics: () => [{ range: range(1), message: "second", severity: 1 }] }),
    );

    const text = resultText(await handleDiagnostics(ctx, { workspace: true }));
    assert.match(text, /first/);
    assert.match(text, /second/);
  });

  it("merges rename edits and skips servers that cannot rename", async () => {
    const edit = (line: number) => ({ range: range(line), newText: "Next" });
    const ctx = multiServerContext(
      mockClient({ rename: async () => ({ changes: { [uri]: [edit(1), edit(2)] } }) }),
      mockClient({ rename: async () => ({ changes: { [uri]: [edit(2), edit(3)] } }) }),
      mockClient({ prepareRename: async () => null }),
    );

    const text = resultText(await handleRename(ctx, { ...position, new_name: "Next" }));
    assert.match(text, /status: ok/);
    assert.match(text, /\(3 edits\)/);
  });

  it("reports no changes when servers can rename but return nothing", async () => {
    const ctx = multiServerContext(mockClient({ rename: async () => null }), mockClient({ rename: async () => ({ changes: {} }) }));

    const text = resultText(await handleRename(ctx, { ...position, new_name: "Next" }));
    assert.match(text, /status: no_results/);
    assert.match(text, /Rename produced no changes/);
  });
});
