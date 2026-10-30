import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../src/cli.js";

describe("cli help", () => {
  it("prints help for --help flag", async () => {
    let output = "";
    const log = console.log;
    console.log = (msg: string) => {
      output += msg;
    };

    try {
      await runCli(["--help"]);
      assert.match(output, /locus serve/);
      assert.match(output, /locus init/);
    } finally {
      console.log = log;
    }
  });

  it("prints help for unknown command fallback", async () => {
    let stderr = "";
    let stdout = "";
    const error = console.error;
    const log = console.log;
    const exit = mock.method(process, "exit", () => {});

    console.error = (msg: string) => {
      stderr += msg;
    };
    console.log = (msg: string) => {
      stdout += msg;
    };

    try {
      await runCli(["not-a-command"]);
      assert.match(stderr, /Unknown command/);
      assert.match(stdout, /locus serve/);
      assert.equal(exit.mock.callCount(), 1);
    } finally {
      console.error = error;
      console.log = log;
      exit.mock.restore();
    }
  });
});

describe("cli init idempotent", () => {
  it("does not overwrite an existing JSON config or modify a legacy TOML config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "locus-cli-idempotent-"));
    const originalCwd = process.cwd();
    try {
      const json = '{"root":".","warm":["custom"]}\n';
      const toml = 'root = "legacy"\n';
      writeFileSync(join(dir, "locus.json"), json);
      writeFileSync(join(dir, "locus.toml"), toml);
      await runCli(["init", "--cwd", dir]);
      await runCli(["init", "--cwd", dir]);

      assert.equal(readFileSync(join(dir, "locus.json"), "utf8"), json);
      assert.equal(readFileSync(join(dir, "locus.toml"), "utf8"), toml);
    } finally {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cli check", () => {
  it("exits with code 1 when binaries missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "locus-cli-check-"));
    const originalCwd = process.cwd();
    const exit = mock.method(process, "exit", () => {});

    try {
      await runCli(["check", "--cwd", dir]);
      assert.ok(exit.mock.callCount() >= 1);
      const code = exit.mock.calls[0]?.arguments[0];
      assert.equal(code, 1);
    } finally {
      exit.mock.restore();
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cli warm", () => {
  it("runs warm without throwing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "locus-cli-warm-"));
    const originalCwd = process.cwd();
    try {
      await runCli(["init", "--cwd", dir]);
      await runCli(["warm", "--cwd", dir]);
    } finally {
      await new Promise((r) => setTimeout(r, 100));
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
