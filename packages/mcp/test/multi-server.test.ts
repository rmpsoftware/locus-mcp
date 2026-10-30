import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { shutdownContext, type LocusServerContext } from "../src/context.js";
import { createLocusServer } from "../src/server.js";

const FAKE_LSP = resolve(import.meta.dirname, "../../core/test/fixtures/fake-lsp.mjs");

function fakeServer(id: string) {
  return { id, languageId: "typescript", extensions: [".ts"], command: process.execPath, args: [FAKE_LSP, id] };
}

// Real server processes end to end: only the fake language server itself is simulated.
describe("multiple language servers over MCP", () => {
  let tempDir: string;
  let file: string;
  let client: Client;
  let ctx: LocusServerContext;

  async function call(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await client.callTool({ name, arguments: args });
    return (result.content as Array<{ text: string }>)[0]!.text;
  }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-multi-"));
    mkdirSync(join(tempDir, "src"));
    file = join(tempDir, "src", "index.ts");
    writeFileSync(file, "export class Greeter {}\n");
    writeFileSync(
      join(tempDir, "locus.json"),
      JSON.stringify({
        servers: [
          { ...fakeServer("alpha"), description: "Primary TypeScript project", args: [FAKE_LSP, "alpha", "workspace-open-file"] },
          { ...fakeServer("beta"), languageId: "javascript" },
          { id: "ghost", languageId: "typescript", extensions: [".ts"], command: "nonexistent-locus-lsp" },
        ],
      }),
    );

    const created = await createLocusServer(tempDir);
    ctx = created.ctx;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await created.server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await shutdownContext(ctx);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("collapses a location both servers report and names the missing server", async () => {
    const text = await call("refs", { file, line: 0, character: 0 });
    assert.match(text, /^status: ok/);
    assert.match(text, /1 result\(s\)/);
    assert.match(text, /ghost failed \(server_unavailable\)/);
  });

  it("returns each server's hover", async () => {
    const text = await call("hover", { file, line: 0, character: 0 });
    assert.match(text, /^status: ok/);
    assert.match(text, /## alpha\n\n\*\*alpha\*\*/);
    assert.match(text, /## beta\n\n\*\*beta\*\*/);
  });

  it("finds a symbol once without a file, across every configured server", async () => {
    const text = await call("locate", { name: "Greeter" });
    assert.match(text, /^status: ok/);
    assert.doesNotMatch(text, /ambiguous/);
    assert.match(text, /ghost failed/);
  });

  it("merges diagnostics from both servers", async () => {
    const text = await call("diagnostics", { file });

    assert.match(text, /3 diagnostic\(s\)/);
    assert.match(text, /shared problem/);
    assert.match(text, /alpha problem/);
    assert.match(text, /beta problem/);

    const workspace = await call("diagnostics", { workspace: true });
    assert.match(workspace, /alpha problem/);
    assert.match(workspace, /beta problem/);
  });

  it("merges rename edits for the same symbol", async () => {
    const text = await call("rename", { file, line: 0, character: 0, new_name: "Welcomer" });
    assert.match(text, /^status: ok/);
    assert.match(text, /\(1 edit\)/);
  });

  it("accepts a path relative to the project root", async () => {
    const text = await call("hover", { file: "src/index.ts", line: 0, character: 0 });
    assert.match(text, /^status: ok/);
    assert.match(text, /## alpha/);
  });

  it("accepts a bare filename when only one file matches", async () => {
    const text = await call("diagnostics", { file: "index.ts" });
    assert.match(text, /^status: ok/);
    assert.match(text, /diagnostic\(s\)/);
  });

  it("lists absolute paths when a bare filename matches several files", async () => {
    mkdirSync(join(tempDir, "lib"));
    const other = join(tempDir, "lib", "index.ts");
    writeFileSync(other, "");

    const text = await call("diagnostics", { file: "index.ts" });
    assert.match(text, /^status: ambiguous_file/);
    assert.ok(text.includes(file) && text.includes(other));
  });

  it("reports a file that does not exist", async () => {
    const text = await call("refs", { file: "Missing.ts", line: 0, character: 0 });
    assert.match(text, /^status: file_not_found/);
  });

  it("lists each server by id in status", async () => {
    const text = await call("status", {});
    assert.match(text, /\*\*alpha\*\*/);
    assert.match(text, /\*\*beta\*\*/);
    assert.match(text, /\*\*ghost\*\*.*MISSING/);
  });

  it("lists all configurations with their resolved roots without starting servers", async () => {
    const text = await call("list_projects", {});
    assert.deepEqual(JSON.parse(text), [
      { project: "alpha", root: tempDir, language: "typescript", description: "Primary TypeScript project" },
      { project: "beta", root: tempDir, language: "javascript" },
      { project: "ghost", root: tempDir, language: "typescript" },
    ]);
    assert.ok((await ctx.manager.status()).every((s) => s.state === "stopped"));
  });

  it("filters workspace and document locate requests before starting clients", async () => {
    const workspace = await call("locate", { name: "Greeter", project: "alpha", lang: "typescript" });
    assert.match(workspace, /^status: ok/);
    assert.doesNotMatch(workspace, /ghost failed/);
    const document = await call("locate", { file, lang: "javascript" });
    assert.match(document, /^status: ok/);
    const statuses = await ctx.manager.status();
    assert.equal(statuses.find((s) => s.id === "alpha")?.state, "ready");
    assert.equal(statuses.find((s) => s.id === "beta")?.state, "ready");
    assert.equal(statuses.find((s) => s.id === "ghost")?.state, "stopped");
  });

  for (const [name, args] of [
    ["locate", { name: "Greeter" }],
    ["locate", { file: "src/index.ts" }],
    ["hover", { file: "src/index.ts", name: "Greeter" }],
    ["hover", { file: "src/index.ts", line: 0, character: 0 }],
    ["refs", { file: "src/index.ts", line: 0, character: 0 }],
    ["rename", { file: "src/index.ts", line: 0, character: 0, new_name: "NewName" }],
    ["diagnostics", { file: "src/index.ts" }],
  ] as const) {
    it(`${name} starts only the server matching both filters`, async () => {
      const text = await call(name, { ...args, project: "alpha", lang: "typescript" });
      assert.match(text, /^status: ok/);
      const statuses = await ctx.manager.status();
      assert.equal(statuses.find((s) => s.id === "alpha")?.state, "ready");
      assert.equal(statuses.find((s) => s.id === "beta")?.state, "stopped");
      assert.equal(statuses.find((s) => s.id === "ghost")?.state, "stopped");
    });
  }

  it("applies filters to hover by position and name, refs, and rename", async () => {
    const byPosition = await call("hover", { file, line: 0, character: 0, lang: "javascript" });
    assert.match(byPosition, /\*\*beta\*\*/);
    assert.doesNotMatch(byPosition, /alpha|ghost/);
    const byName = await call("hover", { file, name: "Greeter", project: "alpha" });
    assert.match(byName, /\*\*alpha\*\*/);
    assert.doesNotMatch(byName, /beta|ghost/);
    for (const name of ["refs", "rename"]) {
      const text = await call(name, { file, line: 0, character: 0, project: "alpha", new_name: "NewName" });
      assert.match(text, /^status: ok/, name);
      assert.doesNotMatch(text, /ghost failed/, name);
    }
    assert.equal((await ctx.manager.status()).find((s) => s.id === "ghost")?.state, "stopped");
  });

  it("filters file and cached workspace diagnostics independently", async () => {
    await call("diagnostics", { file });
    const fileResult = await call("diagnostics", { file, project: "alpha" });
    assert.match(fileResult, /alpha problem/);
    assert.doesNotMatch(fileResult, /beta problem|ghost failed/);
    const workspace = await call("diagnostics", { workspace: true, lang: "javascript" });
    assert.match(workspace, /beta problem/);
    assert.doesNotMatch(workspace, /alpha problem/);
  });

  it("does not start servers for filtered workspace diagnostics", async () => {
    const text = await call("diagnostics", { workspace: true, project: "beta" });
    assert.match(text, /No workspace diagnostics/);
    assert.ok((await ctx.manager.status()).every((s) => s.state === "stopped"));
  });

  it("reports unknown or incompatible filters rather than querying another server", async () => {
    for (const args of [
      { name: "Greeter", project: "missing" },
      { name: "Greeter", lang: "missing" },
      { name: "Greeter", project: "alpha", lang: "javascript" },
    ]) {
      const text = await call("locate", args);
      assert.match(text, /^status: server_unavailable/);
      assert.match(text, /No server configuration matches/);
    }
    assert.ok((await ctx.manager.status()).every((s) => s.state === "stopped"));
  });

  it("uses project filtering to resolve ambiguous filenames within server roots", async () => {
    const api = join(tempDir, "api");
    const web = join(tempDir, "web");
    mkdirSync(api);
    mkdirSync(web);
    writeFileSync(join(api, "same.ts"), "");
    writeFileSync(join(web, "same.ts"), "");
    await shutdownContext(ctx);
    ctx.configs.splice(0, ctx.configs.length,
      { ...fakeServer("api"), root: "api" },
      { ...fakeServer("web"), root: "web" },
    );

    assert.deepEqual(JSON.parse(await call("list_projects", {})), [
      { project: "api", root: api, language: "typescript" },
      { project: "web", root: web, language: "typescript" },
    ]);
    assert.match(await call("locate", { file: "same.ts" }), /^status: ambiguous_file/);
    const result = await call("locate", { file: "same.ts", project: "web" });
    assert.match(result, /^status: ok/);
    assert.ok(result.includes(join(web, "same.ts")));
    assert.ok(!result.includes(join(api, "same.ts")));
    writeFileSync(join(tempDir, "same.ts"), "");
    const selected = await call("locate", { file: "same.ts", project: "web" });
    assert.match(selected, /^status: ok/);
    assert.ok(selected.includes(join(web, "same.ts")));
    const outside = await call("locate", { file: join(api, "same.ts"), project: "web" });
    assert.match(outside, /^status: no_results/);
  });
});
