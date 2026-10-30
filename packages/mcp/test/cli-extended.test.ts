import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LspManager } from "@rmpsoftware/locus-core";
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
      const json = '{"root":".","servers":[{"id":"custom","warm":true}]}\n';
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
  it("uses explicit server flags instead of language detection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "locus-cli-warm-flags-"));
    const originalCwd = process.cwd();
    const configured = mock.method(LspManager.prototype, "warmConfigured", async () => {});
    const fallback = mock.method(LspManager.prototype, "warm", async () => {});
    try {
      writeFileSync(join(dir, "package.json"), "{}");
      writeFileSync(join(dir, "locus.json"), JSON.stringify({
        servers: [
          { id: "custom", languageId: "typescript", extensions: [".ts"], command: "node", warm: true },
          { id: "other", languageId: "typescript", extensions: [".ts"], command: "node", warm: false },
        ],
      }));
      await runCli(["warm", "--cwd", dir]);
      assert.equal(configured.mock.callCount(), 1);
      assert.equal(fallback.mock.callCount(), 0);
    } finally {
      configured.mock.restore();
      fallback.mock.restore();
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("retains language detection when no server has a warm flag", async () => {
    const dir = mkdtempSync(join(tmpdir(), "locus-cli-warm-detect-"));
    const originalCwd = process.cwd();
    const fallback = mock.method(LspManager.prototype, "warm", async () => {});
    try {
      writeFileSync(join(dir, "package.json"), "{}");
      await runCli(["warm", "--cwd", dir]);
      assert.deepEqual(fallback.mock.calls[0]?.arguments, [["typescript"]]);
    } finally {
      fallback.mock.restore();
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats an explicit false flag as selecting no servers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "locus-cli-warm-disabled-"));
    const originalCwd = process.cwd();
    const configured = mock.method(LspManager.prototype, "warmConfigured", async () => {});
    const fallback = mock.method(LspManager.prototype, "warm", async () => {});
    let output = "";
    const log = mock.method(console, "log", (message: string) => { output += `${message}\n`; });
    try {
      writeFileSync(join(dir, "locus.json"), JSON.stringify({
        servers: [{ id: "custom", languageId: "typescript", extensions: [".ts"], command: "node", warm: false }],
      }));
      await runCli(["warm", "--cwd", dir]);
      assert.equal(configured.mock.callCount(), 1);
      assert.equal(fallback.mock.callCount(), 0);
      assert.match(output, /Warming: no servers/);
    } finally {
      log.mock.restore();
      configured.mock.restore();
      fallback.mock.restore();
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
