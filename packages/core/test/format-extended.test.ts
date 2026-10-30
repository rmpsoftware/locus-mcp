import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatHover,
  formatDiagnostics,
  formatWorkspaceDiagnostics,
  formatHovers,
  formatStatus,
  formatRenamePreview,
  formatLocations,
  errorResult,
  okResult,
  filePathToUri,
} from "../src/index.js";
import { DiagnosticSeverity } from "../src/lsp-client/types.js";
import { resolve } from "node:path";

const ROOT = resolve("/proj");

describe("formatHover", () => {
  it("returns fallback for null hover", () => {
    assert.equal(formatHover(null), "No hover information available.");
  });

  it("formats string content", () => {
    assert.equal(formatHover({ contents: "type Foo = string" }), "type Foo = string");
  });

  it("formats MarkupContent object", () => {
    assert.equal(
      formatHover({ contents: { kind: "markdown", value: "**Greeter** class" } }),
      "**Greeter** class",
    );
  });

  it("formats array of contents", () => {
    const result = formatHover({
      contents: [
        { kind: "markdown", value: "Line 1" },
        "Line 2",
      ],
    });
    assert.match(result, /Line 1/);
    assert.match(result, /Line 2/);
  });
});

describe("formatDiagnostics", () => {
  it("reports no diagnostics message", () => {
    const text = formatDiagnostics([], resolve(ROOT, "src/foo.ts"), ROOT);
    assert.match(text, /No diagnostics/);
  });

  it("groups diagnostics by severity", () => {
    const filePath = resolve(ROOT, "src/foo.ts");
    const text = formatDiagnostics(
      [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: DiagnosticSeverity.Error, message: "Type error" },
        { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }, severity: DiagnosticSeverity.Warning, message: "Unused var" },
      ],
      filePath,
      ROOT,
    );
    assert.match(text, /## error/);
    assert.match(text, /## warning/);
    assert.match(text, /Type error/);
    assert.match(text, /Unused var/);
  });
});

describe("formatWorkspaceDiagnostics", () => {
  it("returns message when no files have diagnostics", () => {
    assert.equal(formatWorkspaceDiagnostics(new Map(), ROOT), "No workspace diagnostics.");
  });

  it("formats multiple files", () => {
    const uri = filePathToUri(resolve(ROOT, "src/a.ts"));
    const byFile = new Map([
      [
        uri,
        [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: DiagnosticSeverity.Error,
            message: "Error in a.ts",
          },
        ],
      ],
    ]);
    const text = formatWorkspaceDiagnostics(byFile, ROOT);
    assert.match(text, /Error in a\.ts/);
  });
});

describe("formatHovers", () => {
  const hover = (value: string) => ({ contents: value });

  it("returns a lone answer without a server heading", () => {
    assert.equal(formatHovers([{ server: "a", hover: hover("type A") }, { server: "b", hover: null }]), "type A");
  });

  it("collapses identical answers", () => {
    assert.equal(formatHovers([{ server: "a", hover: hover("same") }, { server: "b", hover: hover("same") }]), "same");
  });

  it("labels distinct answers by server", () => {
    const text = formatHovers([{ server: "a", hover: hover("type A") }, { server: "b", hover: hover("type B") }]);
    assert.equal(text, "## a\n\ntype A\n\n## b\n\ntype B");
  });

  it("reports no information when nothing answered", () => {
    assert.match(formatHovers([{ server: "a", hover: null }, { server: "b", hover: hover(" ") }]), /No hover information/);
  });
});

describe("formatStatus", () => {
  it("includes server state and binary availability", () => {
    const text = formatStatus([
      {
        id: "typescript",
        command: "typescript-language-server",
        state: "ready",
        binaryAvailable: true,
        warmed: true,
        openDocuments: 2,
      },
      {
        id: "go",
        command: "gopls",
        state: "stopped",
        binaryAvailable: false,
        warmed: false,
        openDocuments: 0,
      },
    ]);
    assert.match(text, /Locus LSP Status/);
    assert.match(text, /typescript.*ready.*installed/);
    assert.match(text, /go.*MISSING/);
  });
});

describe("formatRenamePreview", () => {
  it("formats rename edits per file", () => {
    const uri = filePathToUri(resolve(ROOT, "src/foo.ts"));
    const text = formatRenamePreview(
      {
        [uri]: [
          {
            range: { start: { line: 4, character: 6 }, end: { line: 4, character: 11 } },
            newText: "newName",
          },
        ],
      },
      ROOT,
    );
    assert.match(text, /Rename preview/);
    assert.match(text, /L5:/);
    assert.match(text, /newName/);
  });

  it("truncates long edit lists", () => {
    const uri = filePathToUri(resolve(ROOT, "src/big.ts"));
    const edits = Array.from({ length: 25 }, (_, i) => ({
      range: { start: { line: i, character: 0 }, end: { line: i, character: 1 } },
      newText: `edit${i}`,
    }));
    const text = formatRenamePreview({ [uri]: edits }, ROOT);
    assert.match(text, /5 more edits/);
  });
});

describe("formatLocations", () => {
  it("formats multiple location refs", () => {
    const refs = [
      {
        uri: filePathToUri(resolve(ROOT, "src/a.ts")),
        range: { start: { line: 2, character: 4 }, end: { line: 2, character: 8 } },
      },
      {
        uri: filePathToUri(resolve(ROOT, "src/b.ts")),
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      },
    ];
    const lines = formatLocations(refs, ROOT);
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /a\.ts:3:5/);
    assert.match(lines[1]!, /b\.ts:1:1/);
  });
});

describe("LocusResult status helpers", () => {
  it("errorResult sets status and message", () => {
    const result = errorResult("server_unavailable", "Binary missing");
    assert.equal(result.status, "server_unavailable");
    assert.equal(result.message, "Binary missing");
    assert.equal(result.data, undefined);
  });

  it("okResult sets status and data", () => {
    const result = okResult("output text", "3 results");
    assert.equal(result.status, "ok");
    assert.equal(result.data, "output text");
    assert.equal(result.message, "3 results");
  });

  it("supports all discriminated status codes", () => {
    const statuses = [
      "ok",
      "no_results",
      "server_starting",
      "server_unavailable",
      "ambiguous_symbol",
      "error",
    ] as const;

    for (const status of statuses) {
      const result = errorResult(status, `test ${status}`);
      assert.equal(result.status, status);
    }
  });
});
