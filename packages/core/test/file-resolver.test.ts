import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { LspManager } from "../src/lsp-client/manager.js";
import type { LanguageServerConfig } from "../src/registry/registry.js";

function server(id: string, root?: string, extensions = [".cs"]): LanguageServerConfig {
  return { id, root, languageId: "csharp", extensions, command: "fake-lsp" };
}

describe("LspManager.resolveFile", () => {
  let rootPath: string;

  function touch(...files: string[]): void {
    for (const file of files) {
      mkdirSync(dirname(join(rootPath, file)), { recursive: true });
      writeFileSync(join(rootPath, file), "");
    }
  }

  const manager = (...configs: LanguageServerConfig[]) => new LspManager(rootPath, configs);

  beforeEach(() => {
    rootPath = mkdtempSync(join(tmpdir(), "locus-files-"));
  });

  afterEach(() => {
    rmSync(rootPath, { recursive: true, force: true });
  });

  describe("absolute paths", () => {
    it("returns an existing file, even with no server for it", async () => {
      touch("notes.txt");
      const file = join(rootPath, "notes.txt");
      assert.deepEqual(await manager().resolveFile(file), { status: "ok", file });
    });

    it("normalizes the path", async () => {
      touch("a/b.cs");
      const result = await manager().resolveFile(`${rootPath}/a/../a/b.cs`);
      assert.deepEqual(result, { status: "ok", file: join(rootPath, "a/b.cs") });
    });

    it("reports a missing file without searching for its name", async () => {
      touch("src/b.cs");
      const result = await manager(server("a")).resolveFile(join(rootPath, "elsewhere/b.cs"));
      assert.equal(result.status, "file_not_found");
    });
  });

  describe("relative paths", () => {
    it("resolves against the project root, not the process working directory", async () => {
      touch("src/a.cs");
      assert.deepEqual(await manager(server("a")).resolveFile("src/a.cs"), { status: "ok", file: join(rootPath, "src/a.cs") });
    });

    it("prefers the project root over a server root", async () => {
      touch("src/a.cs", "api/src/a.cs");
      const result = await manager(server("api", "api")).resolveFile("src/a.cs");
      assert.deepEqual(result, { status: "ok", file: join(rootPath, "src/a.cs") });
    });

    it("falls back to a server root", async () => {
      touch("api/src/a.cs");
      const result = await manager(server("api", "api")).resolveFile("src/a.cs");
      assert.deepEqual(result, { status: "ok", file: join(rootPath, "api/src/a.cs") });
    });

    it("reports every server root that has the file", async () => {
      touch("api/src/a.cs", "web/src/a.cs");
      const result = await manager(server("api", "api"), server("web", "web")).resolveFile("src/a.cs");
      assert.equal(result.status, "ambiguous_file");
      assert.equal(
        result.status === "ambiguous_file" && result.data,
        [join(rootPath, "api/src/a.cs"), join(rootPath, "web/src/a.cs")].join("\n"),
      );
    });

    it("counts a root shared by two servers once", async () => {
      touch("api/src/a.cs");
      const result = await manager(server("one", "api"), server("two", "api")).resolveFile("src/a.cs");
      assert.equal(result.status, "ok");
    });

    it("ignores roots of servers for other extensions", async () => {
      touch("web/src/a.cs");
      const result = await manager(server("web", "web", [".ts"])).resolveFile("src/a.cs");
      assert.equal(result.status, "file_not_found");
    });

    it("does not search by name when the path has a directory", async () => {
      touch("api/deep/src/a.cs");
      const result = await manager(server("api", "api")).resolveFile("src/a.cs");
      assert.equal(result.status, "file_not_found");
    });

    it("does not treat a directory as a file", async () => {
      touch("src.cs/a.cs");
      const result = await manager(server("a")).resolveFile("src.cs");
      assert.equal(result.status, "file_not_found");
    });
  });

  describe("bare filenames", () => {
    it("finds a unique file anywhere under a server root", async () => {
      touch("api/src/deep/Helper.cs", "api/src/Other.cs");
      const result = await manager(server("api", "api")).resolveFile("Helper.cs");
      assert.deepEqual(result, { status: "ok", file: join(rootPath, "api/src/deep/Helper.cs") });
    });

    it("prefers a file directly under a server root over deeper matches", async () => {
      touch("api/Helper.cs", "api/src/Helper.cs");
      const result = await manager(server("api", "api")).resolveFile("Helper.cs");
      assert.deepEqual(result, { status: "ok", file: join(rootPath, "api/Helper.cs") });
    });

    it("lists absolute paths in sorted order when several match", async () => {
      touch("api/z/Helper.cs", "api/a/Helper.cs");
      const result = await manager(server("api", "api")).resolveFile("Helper.cs");
      assert.deepEqual(result, {
        status: "ambiguous_file",
        message: 'Multiple files match "Helper.cs"',
        data: [join(rootPath, "api/a/Helper.cs"), join(rootPath, "api/z/Helper.cs")].join("\n"),
      });
    });

    it("searches every server root for the extension", async () => {
      touch("api/x/Helper.cs", "web/y/Helper.cs");
      const result = await manager(server("api", "api"), server("web", "web")).resolveFile("Helper.cs");
      assert.equal(result.status, "ambiguous_file");
    });

    it("reports a file under nested roots once", async () => {
      touch("api/src/deep/Helper.cs");
      const result = await manager(server("outer"), server("inner", "api/src")).resolveFile("Helper.cs");
      assert.deepEqual(result, { status: "ok", file: join(rootPath, "api/src/deep/Helper.cs") });
    });

    it("only searches roots of servers for the extension", async () => {
      touch("web/deep/Helper.cs");
      const result = await manager(server("api", "api"), server("web", "web", [".ts"])).resolveFile("Helper.cs");
      assert.equal(result.status, "file_not_found");
    });

    it("skips the server's ignored directories at any depth", async () => {
      touch("src/Helper.cs", "src/bin/Debug/Helper.cs", "obj/Helper.cs");
      const config = { ...server("a"), ignoreDirectories: ["bin", "obj"] };
      const result = await manager(config).resolveFile("Helper.cs");
      assert.deepEqual(result, { status: "ok", file: join(rootPath, "src/Helper.cs") });
    });

    it("skips no ordinary directories unless configured", async () => {
      touch("src/Helper.cs", "src/bin/Helper.cs", "node_modules/Helper.cs");
      const result = await manager(server("a")).resolveFile("Helper.cs");
      assert.equal(result.status, "ambiguous_file");
    });

    it("always skips hidden directories", async () => {
      touch("src/Helper.cs", ".git/Helper.cs", "src/.vs/Helper.cs");
      const result = await manager(server("a")).resolveFile("Helper.cs");
      assert.deepEqual(result, { status: "ok", file: join(rootPath, "src/Helper.cs") });
    });

    it("applies each server's ignored directories to its own root", async () => {
      touch("api/gen/Helper.cs", "web/gen/Helper.cs");
      const api = { ...server("api", "api"), ignoreDirectories: ["gen"] };
      const result = await manager(api, server("web", "web")).resolveFile("Helper.cs");
      assert.deepEqual(result, { status: "ok", file: join(rootPath, "web/gen/Helper.cs") });
    });

    it("still resolves a full path inside an ignored directory", async () => {
      touch("bin/Helper.cs");
      const config = { ...server("a"), ignoreDirectories: ["bin"] };
      const result = await manager(config).resolveFile("bin/Helper.cs");
      assert.equal(result.status, "ok");
    });

    it("matches the whole name exactly", async () => {
      touch("src/MyHelper.cs", "src/helper.cs");
      const result = await manager(server("a")).resolveFile("Helper.cs");
      assert.equal(result.status, "file_not_found");
    });

    it("reports an unknown extension as not found", async () => {
      touch("src/Helper.xyz");
      const result = await manager(server("a")).resolveFile("Helper.xyz");
      assert.equal(result.status, "file_not_found");
      assert.match(result.status === "file_not_found" ? result.message : "", /Helper\.xyz/);
    });

    it("tolerates a server root that does not exist", async () => {
      touch("api/x/Helper.cs");
      const result = await manager(server("gone", "missing"), server("api", "api")).resolveFile("Helper.cs");
      assert.equal(result.status, "ok");
    });
  });
});
