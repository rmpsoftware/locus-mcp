import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLocusContext, shutdownContext } from "../src/context.js";

describe("createLocusContext", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-ctx-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads config and sets rootPath from cwd", () => {
    writeFileSync(join(tempDir, "locus.json"), JSON.stringify({ root: "." }));

    const ctx = createLocusContext(tempDir);

    assert.equal(ctx.rootPath, tempDir);
    assert.ok(ctx.configs.length >= 4);
    assert.ok(ctx.manager);
    assert.ok(ctx.resolver);
  });

  it("uses built-in servers when no config file exists", () => {
    const ctx = createLocusContext(tempDir);

    assert.equal(ctx.rootPath, tempDir);
    assert.ok(ctx.configs.some((c) => c.languageId === "typescript"));
    assert.ok(ctx.configs.some((c) => c.languageId === "python"));
  });
});

describe("shutdownContext", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-shutdown-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("calls manager.stopAll", async () => {
    const ctx = createLocusContext(tempDir);
    let stopped = false;

    ctx.manager.stopAll = async () => {
      stopped = true;
    };

    await shutdownContext(ctx);
    assert.equal(stopped, true);
  });
});
