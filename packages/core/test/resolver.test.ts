import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SymbolResolver } from "../src/symbol-layer/resolver.js";
import type { LspClient } from "../src/lsp-client/client.js";
import type { SymbolInformation } from "../src/lsp-client/types.js";
import { filePathToUri } from "../src/lsp-client/connection.js";
import { resolve } from "node:path";

const ROOT = resolve("/proj");

function makeSymbol(
  name: string,
  containerName?: string,
  file = "src/index.ts",
): SymbolInformation {
  return {
    name,
    kind: 12,
    containerName,
    location: {
      uri: filePathToUri(resolve(ROOT, file)),
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: name.length },
      },
    },
  };
}

function mockClient(symbols: SymbolInformation[]): LspClient {
  return {
    workspaceSymbol: async (query: string) =>
      symbols.filter(
        (s) =>
          s.name.includes(query) ||
          `${s.containerName ?? ""}.${s.name}`.includes(query),
      ),
    documentSymbol: async () => symbols,
  } as unknown as LspClient;
}

describe("SymbolResolver.parseQualifiedName", () => {
  const resolver = new SymbolResolver({ rootPath: ROOT });

  it("parses simple name", () => {
    assert.deepEqual(resolver.parseQualifiedName("foo"), { member: "foo" });
  });

  it("parses nested qualified name", () => {
    assert.deepEqual(resolver.parseQualifiedName("A.B.C.method"), {
      container: "A.B.C",
      member: "method",
    });
  });

  it("parses two-part qualified name", () => {
    assert.deepEqual(resolver.parseQualifiedName("Foo.bar"), {
      container: "Foo",
      member: "bar",
    });
  });
});

describe("SymbolResolver.findByName", () => {
  const resolver = new SymbolResolver({ rootPath: ROOT });

  it("returns no_results for empty query", async () => {
    const result = await resolver.findByName([mockClient([])], "   ");
    assert.equal(result.status, "no_results");
    assert.match(result.message ?? "", /Empty query/);
  });

  it("returns no_results when nothing matches", async () => {
    const result = await resolver.findByName([mockClient([])], "NonExistent");
    assert.equal(result.status, "no_results");
    assert.match(result.message ?? "", /No symbols matching/);
  });

  it("returns ok for exact single match", async () => {
    const symbols = [makeSymbol("Greeter")];
    const result = await resolver.findByName([mockClient(symbols)], "Greeter");
    assert.equal(result.status, "ok");
    assert.equal(result.symbols.length, 1);
    assert.equal(result.symbols[0]!.name, "Greeter");
  });

  it("returns ok for qualified name match", async () => {
    const symbols = [makeSymbol("greet", "Greeter")];
    const result = await resolver.findByName([mockClient(symbols)], "Greeter.greet");
    assert.equal(result.status, "ok");
    assert.equal(result.symbols[0]!.qualifiedName, "Greeter.greet");
  });

  it("returns ambiguous_symbol for multiple exact matches", async () => {
    const symbols = [
      makeSymbol("process", "ModuleA", "src/a.ts"),
      makeSymbol("process", "ModuleB", "src/b.ts"),
    ];
    const result = await resolver.findByName([mockClient(symbols)], "process");
    assert.equal(result.status, "ambiguous_symbol");
    assert.ok(result.symbols.length >= 2);
  });

  it("returns ok for single partial match when no exact match", async () => {
    const symbols = [makeSymbol("fetchUserData")];
    const result = await resolver.findByName([mockClient(symbols)], "fetchUser");
    assert.equal(result.status, "ok");
    assert.equal(result.symbols[0]!.name, "fetchUserData");
  });

  it("limits ambiguous results to 10 symbols", async () => {
    const symbols = Array.from({ length: 15 }, (_, i) =>
      makeSymbol("handler", `Module${i}`, `src/m${i}.ts`),
    );
    const result = await resolver.findByName([mockClient(symbols)], "handler");
    assert.equal(result.status, "ambiguous_symbol");
    assert.equal(result.symbols.length, 10);
  });

  it("does not report a symbol found by two servers as ambiguous", async () => {
    const symbols = [makeSymbol("Greeter")];
    const result = await resolver.findByName([mockClient(symbols), mockClient(symbols)], "Greeter");
    assert.equal(result.status, "ok");
    assert.equal(result.symbols.length, 1);
  });

  it("ranks symbols from all servers together", async () => {
    const result = await resolver.findByName(
      [mockClient([makeSymbol("process", "A", "src/a.ts")]), mockClient([makeSymbol("process", "B", "src/b.py")])],
      "process",
    );
    assert.equal(result.status, "ambiguous_symbol");
    assert.deepEqual(result.symbols.map((s) => s.qualifiedName).sort(), ["A.process", "B.process"]);
  });

  it("keeps symbols from other servers and reports the failure", async () => {
    const broken = {
      ...mockClient([]),
      workspaceSymbol: async () => {
        throw new Error("server_unavailable");
      },
    } as unknown as LspClient;

    const result = await resolver.findByName([broken, mockClient([makeSymbol("Greeter")])], "Greeter");
    assert.equal(result.status, "ok");
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]!.client, broken);
  });

  it("reports every server once when all fail", async () => {
    let calls = 0;
    const broken = {
      workspaceSymbol: async () => {
        calls++;
        throw new Error("server_unavailable");
      },
    } as unknown as LspClient;

    const result = await resolver.findByName([broken, broken], "Greeter");
    assert.equal(result.status, "no_results");
    assert.equal(result.failures.length, 2);
    assert.equal(calls, 2);
  });

  it("falls back to the member name on servers that answered", async () => {
    const queries: string[] = [];
    const client = {
      workspaceSymbol: async (query: string) => {
        queries.push(query);
        return query === "greet" ? [makeSymbol("greet", "Other")] : [];
      },
    } as unknown as LspClient;

    const result = await resolver.findByName([client], "Greeter.greet");
    assert.deepEqual(queries, ["Greeter.greet", "greet"]);
    assert.equal(result.symbols[0]!.name, "greet");
  });

  it("opens a supplied file before searching workspace symbols", async () => {
    const calls: string[] = [];
    const client = {
      didOpen: async (file: string) => { calls.push(`open:${file}`); },
      workspaceSymbol: async (query: string) => {
        calls.push(`workspace:${query}`);
        return [makeSymbol("Greeter")];
      },
    } as unknown as LspClient;
    const result = await resolver.findByName([client], "Greeter", resolve(ROOT, "src/index.ts"));
    assert.deepEqual(calls, [`open:${resolve(ROOT, "src/index.ts")}`, "workspace:Greeter"]);
    assert.equal(result.status, "ok");
  });

  it("falls back to matching document symbols when workspace search is empty", async () => {
    const client = {
      didOpen: async () => {},
      workspaceSymbol: async () => [],
      documentSymbol: async () => [makeSymbol("other"), makeSymbol("greet", "Greeter")],
    } as unknown as LspClient;
    const result = await resolver.findByName([client], "Greeter.greet", resolve(ROOT, "src/index.ts"));
    assert.equal(result.status, "ok");
    assert.equal(result.symbols[0]?.qualifiedName, "Greeter.greet");
  });

  it("does not return unrelated document symbols on fallback", async () => {
    const client = {
      didOpen: async () => {},
      workspaceSymbol: async () => [],
      documentSymbol: async () => [makeSymbol("other")],
    } as unknown as LspClient;
    const result = await resolver.findByName([client], "Missing", resolve(ROOT, "src/index.ts"));
    assert.equal(result.status, "no_results");
  });

  it("retains failures opening a file and returns other servers' document matches", async () => {
    const broken = {
      didOpen: async () => { throw new Error("failed to open"); },
    } as unknown as LspClient;
    const working = {
      didOpen: async () => {},
      workspaceSymbol: async () => [],
      documentSymbol: async () => [makeSymbol("Greeter")],
    } as unknown as LspClient;
    const result = await resolver.findByName([broken, working], "Greeter", resolve(ROOT, "src/index.ts"));
    assert.equal(result.status, "ok");
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]?.client, broken);
  });

  it("reports document fallback failures rather than returning success", async () => {
    const client = {
      didOpen: async () => {},
      workspaceSymbol: async () => [],
      documentSymbol: async () => { throw new Error("document request failed"); },
    } as unknown as LspClient;
    const result = await resolver.findByName([client], "Greeter", resolve(ROOT, "src/index.ts"));
    assert.equal(result.status, "no_results");
    assert.equal(result.failures.length, 1);
    assert.match(String(result.failures[0]?.error), /document request failed/);
  });
});

describe("SymbolResolver.findAtPosition", () => {
  const resolver = new SymbolResolver({ rootPath: ROOT });

  it("returns undefined when document has no symbols", async () => {
    const result = await resolver.findAtPosition(mockClient([]), "src/empty.ts");
    assert.equal(result, undefined);
  });

  it("returns first symbol from document", async () => {
    const symbols = [makeSymbol("first"), makeSymbol("second")];
    const result = await resolver.findAtPosition(mockClient(symbols), "src/index.ts");
    assert.equal(result?.name, "first");
  });
});
