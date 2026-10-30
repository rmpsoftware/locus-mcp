import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fanOut,
  mergeDiagnostics,
  mergeLocations,
  mergeSymbols,
  mergeWorkspaceEdits,
} from "../src/lsp-client/fan-out.js";
import type { LspClient } from "../src/lsp-client/client.js";
import type { Range } from "../src/lsp-client/types.js";

const client = (id: string) => ({ id }) as unknown as LspClient;

function range(line: number, character = 0): Range {
  return { start: { line, character }, end: { line, character: character + 1 } };
}

describe("fanOut", () => {
  it("sends requests in parallel", async () => {
    const clients = [client("a"), client("b")];
    let release!: () => void;
    const allStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;

    // Each request only finishes once both are in flight, so running them in series would deadlock.
    const { results } = await fanOut(clients, async (c) => {
      if (++started === clients.length) release();
      await allStarted;
      return c.id;
    });

    assert.deepEqual(results.map((r) => r.value), ["a", "b"]);
  });

  it("keeps answers from other servers when one fails", async () => {
    const a = client("a");
    const b = client("b");
    const { results, failures } = await fanOut([a, b], async (c) => {
      if (c === a) throw new Error("boom");
      return "ok";
    });

    assert.deepEqual(results, [{ client: b, value: "ok" }]);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]!.client, a);
    assert.match((failures[0]!.error as Error).message, /boom/);
  });

  it("treats a synchronous throw as that server's failure", async () => {
    const { results, failures } = await fanOut([client("a")], () => {
      throw new Error("sync");
    });

    assert.equal(results.length, 0);
    assert.equal(failures.length, 1);
  });

  it("returns nothing for no clients", async () => {
    assert.deepEqual(await fanOut([], async () => 1), { results: [], failures: [] });
  });
});

describe("mergeLocations", () => {
  it("drops locations reported by several servers and keeps order", () => {
    const merged = mergeLocations([
      [{ uri: "file:///a.ts", range: range(1) }, { uri: "file:///a.ts", range: range(2) }],
      [{ uri: "file:///a.ts", range: range(1) }, { uri: "file:///b.ts", range: range(1) }],
    ]);

    assert.deepEqual(
      merged.map((l) => `${l.uri}:${l.range.start.line}`),
      ["file:///a.ts:1", "file:///a.ts:2", "file:///b.ts:1"],
    );
  });
});

describe("mergeSymbols", () => {
  it("treats same name and start as one symbol even when ranges end differently", () => {
    const location = { uri: "file:///a.ts", range: range(1) };
    const wider = { uri: "file:///a.ts", range: { start: location.range.start, end: { line: 9, character: 0 } } };

    const merged = mergeSymbols([
      [{ name: "foo", kind: 12, location }],
      [{ name: "foo", kind: 12, location: wider }],
      [{ name: "bar", kind: 12, location }],
    ]);

    assert.deepEqual(merged.map((s) => s.name), ["foo", "bar"]);
  });
});

describe("mergeDiagnostics", () => {
  it("keeps distinct messages at the same range", () => {
    const merged = mergeDiagnostics([
      [{ range: range(1), severity: 1, message: "shared" }],
      [
        { range: range(1), severity: 1, message: "shared" },
        { range: range(1), severity: 1, message: "other" },
      ],
    ]);

    assert.deepEqual(merged.map((d) => d.message), ["shared", "other"]);
  });
});

describe("mergeWorkspaceEdits", () => {
  it("combines changes and documentChanges across servers without repeating edits", () => {
    const shared = { range: range(1), newText: "next" };
    const merged = mergeWorkspaceEdits([
      { changes: { "file:///a.ts": [shared] } },
      {
        documentChanges: [
          { textDocument: { uri: "file:///a.ts", version: 1 }, edits: [shared, { range: range(2), newText: "next" }] },
          { textDocument: { uri: "file:///b.ts", version: 1 }, edits: [shared] },
        ],
      },
    ]);

    assert.equal(merged["file:///a.ts"]!.length, 2);
    assert.equal(merged["file:///b.ts"]!.length, 1);
  });

  it("returns no files for empty edits", () => {
    assert.deepEqual(mergeWorkspaceEdits([{}, { changes: {} }]), {});
  });
});
