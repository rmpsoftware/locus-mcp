import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runCli } from "../src/cli.js";

describe("cli init", () => {
  it("creates only a JSON config in a new directory", async () => {
    const dir = join(tmpdir(), `locus-cli-init-${Date.now()}`);
    const originalCwd = process.cwd();
    try {
      await runCli(["init", "--cwd", dir]);
      const { existsSync } = await import("node:fs");
      assert.equal(process.cwd(), realpathSync(dir));
      assert.equal(existsSync(join(dir, "locus.toml")), false);
      assert.ok(existsSync(join(dir, "locus.json")));
    } finally {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("--cwd process behavior", () => {
    it("changes the MCP process directory for a relative path", () => {
      const dir = mkdtempSync(join(tmpdir(), "locus-cli-serve-"));
      try {
        const cli = new URL("../src/cli.ts", import.meta.url).href;
        const script = `
          const { runCli } = await import(${JSON.stringify(cli)});
          await runCli(["serve", "--cwd", ${JSON.stringify(relative(process.cwd(), dir))}]);
          console.log("PROCESS_CWD=" + process.cwd());
          process.exit(0);
        `;
        const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", script], {
          encoding: "utf8",
          timeout: 10000,
        });
        assert.equal(result.status, 0, result.stderr || result.error?.message);
        assert.ok(result.stdout.includes(`PROCESS_CWD=${realpathSync(dir)}`), result.stdout);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("changes the interactive server process directory", () => {
      const dir = mkdtempSync(join(tmpdir(), "locus-interactive-"));
      try {
        const server = new URL("../test-interactive/server.ts", import.meta.url).href;
        const script = `
          process.argv = [process.execPath, "server", "--cwd", ${JSON.stringify(dir)}, "--port", "0"];
          await import(${JSON.stringify(server)});
          console.log("PROCESS_CWD=" + process.cwd());
          process.kill(process.pid, "SIGTERM");
        `;
        const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", script], {
          encoding: "utf8",
          timeout: 10000,
        });
        assert.equal(result.status, 0, result.stderr || result.error?.message);
        assert.ok(result.stdout.includes(`PROCESS_CWD=${realpathSync(dir)}`), result.stdout);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("reports missing or nonexistent working directories", async () => {
      await assert.rejects(runCli(["serve", "--cwd"]), /--cwd requires a path/);
      await assert.rejects(runCli(["serve", "--cwd", "--help"]), /--cwd requires a path/);
      const dir = mkdtempSync(join(tmpdir(), "locus-cli-missing-"));
      try {
        await assert.rejects(runCli(["serve", "--cwd", join(dir, "missing")]), /ENOENT/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
