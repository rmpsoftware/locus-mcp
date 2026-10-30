import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { LspClient } from "@rmpsoftware/locus-core";

const FIXTURE_TS = resolve(import.meta.dirname, "../../../evals/fixtures/typescript");
const FIXTURE_PY = resolve(import.meta.dirname, "../../../evals/fixtures/python");

async function binaryExists(cmd: string): Promise<boolean> {
  const lookup = process.platform === "win32" ? "where" : "which";
  return new Promise((resolve) => {
    const proc = spawn(lookup, [cmd], { shell: true, stdio: "ignore" });
    proc.on("exit", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

describe("integration", () => {
  it("typescript-language-server locates Greeter symbol", async (t) => {
    if (!(await binaryExists("typescript-language-server"))) {
      t.skip("typescript-language-server not installed");
      return;
    }

    const client = new LspClient({
      rootPath: FIXTURE_TS,
      serverConfig: {
        id: "typescript",
        languageId: "typescript",
        extensions: [".ts"],
        command: "typescript-language-server",
        args: ["--stdio"],
      },
      requestTimeoutMs: 60_000,
    });

    try {
      await client.start();
      const srcFile = join(FIXTURE_TS, "src", "index.ts");
      await client.didOpen(srcFile);

      const symbols = await client.workspaceSymbol("Greeter");
      assert.ok(symbols.length > 0, "expected Greeter symbol");

      const hover = await client.hover(srcFile, 4, 10);
      assert.ok(hover, "expected hover info");
    } finally {
      await client.stop();
    }
  });

  it("pyright locates greet function", async (t) => {
    if (!(await binaryExists("pyright-langserver"))) {
      t.skip("pyright-langserver not installed");
      return;
    }

    const client = new LspClient({
      rootPath: FIXTURE_PY,
      serverConfig: {
        id: "python",
        languageId: "python",
        extensions: [".py"],
        command: "pyright-langserver",
        args: ["--stdio"],
      },
      requestTimeoutMs: 60_000,
    });

    try {
      await client.start();
      const srcFile = join(FIXTURE_PY, "main.py");
      await client.didOpen(srcFile);

      const symbols = await client.documentSymbol(srcFile);
      assert.ok(symbols.some((s) => s.name.includes("greet") || s.name === "greet"));
    } finally {
      await client.stop();
    }
  });
});
