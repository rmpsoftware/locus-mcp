import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { LspClient, ServerFailure } from "@rmpsoftware/locus-core";
import { allFailedResult, handleLspError, parsePosition, withFailures } from "../src/tools/helpers.js";

function failure(id: string, message: string): ServerFailure {
  return { client: { id } as unknown as LspClient, error: new Error(message) };
}

describe("handleLspError", () => {
  it("maps server_starting message", () => {
    const result = handleLspError(new Error("server_starting"));
    assert.equal(result.status, "server_starting");
    assert.match(result.message ?? "", /still starting/);
  });

  it("maps server_unavailable message", () => {
    const result = handleLspError(new Error("server_unavailable"));
    assert.equal(result.status, "server_unavailable");
    assert.match(result.message ?? "", /locus check/);
  });

  it("maps timeout errors to server_starting", () => {
    const result = handleLspError(new Error("Request timed out after 5000ms"));
    assert.equal(result.status, "server_starting");
  });

  it("maps unknown errors to error status", () => {
    const result = handleLspError(new Error("unexpected failure"));
    assert.equal(result.status, "error");
    assert.equal(result.message, "unexpected failure");
  });

  it("handles non-Error values", () => {
    const result = handleLspError("string error");
    assert.equal(result.status, "error");
    assert.equal(result.message, "string error");
  });
});

describe("allFailedResult", () => {
  it("passes a single failure through unchanged", () => {
    assert.deepEqual(allFailedResult([failure("a", "server_unavailable")]), handleLspError(new Error("server_unavailable")));
  });

  it("names every server when several fail", () => {
    const result = allFailedResult([failure("a", "server_unavailable"), failure("b", "unexpected")]);
    assert.equal(result.status, "server_unavailable");
    assert.match(result.message ?? "", /a failed \(server_unavailable\)/);
    assert.match(result.message ?? "", /b failed \(error\): unexpected/);
  });

  it("prefers a retryable status", () => {
    const result = allFailedResult([failure("a", "server_unavailable"), failure("b", "server_starting")]);
    assert.equal(result.status, "server_starting");
  });
});

describe("withFailures", () => {
  it("leaves a result alone when nothing failed", () => {
    const result = { status: "ok" as const, data: "x" };
    assert.equal(withFailures(result, []), result);
  });

  it("appends failed servers after the existing message", () => {
    const result = withFailures({ status: "ok" as const, message: "2 result(s)" }, [failure("a", "server_starting")]);
    assert.equal(result.status, "ok");
    assert.match(result.message ?? "", /^2 result\(s\)\na failed \(server_starting\)/);
  });

  it("uses the failure note as the message when there was none", () => {
    const result = withFailures({ status: "ok" as const }, [failure("a", "server_starting")]);
    assert.match(result.message ?? "", /^a failed/);
  });
});

describe("parsePosition", () => {
  it("returns undefined for empty input", () => {
    assert.equal(parsePosition(undefined), undefined);
    assert.equal(parsePosition(""), undefined);
  });

  it("parses path:line:col with 1-based coordinates", () => {
    const pos = parsePosition("src/foo.ts:10:5");
    assert.deepEqual(pos, { file: "src/foo.ts", line: 9, character: 4 });
  });

  it("returns undefined for invalid format", () => {
    assert.equal(parsePosition("not-a-position"), undefined);
    assert.equal(parsePosition("file.ts"), undefined);
    assert.equal(parsePosition("file.ts:abc:1"), undefined);
  });

  it("handles Windows-style paths with drive letter", () => {
    const pos = parsePosition("C:/proj/src/foo.ts:1:1");
    assert.equal(pos?.file, "C:/proj/src/foo.ts");
    assert.equal(pos?.line, 0);
    assert.equal(pos?.character, 0);
  });

  it("parses backslash Windows paths", () => {
    const pos = parsePosition("C:\\proj\\src\\foo.ts:2:3");
    assert.equal(pos?.file, "C:\\proj\\src\\foo.ts");
    assert.equal(pos?.line, 1);
    assert.equal(pos?.character, 2);
  });

  it("returns undefined for non-numeric line or column", () => {
    assert.equal(parsePosition("src/foo.ts:abc:1"), undefined);
    assert.equal(parsePosition("src/foo.ts:1:xyz"), undefined);
  });
});
