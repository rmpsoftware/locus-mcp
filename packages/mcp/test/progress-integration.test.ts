import { it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { LspManager, SymbolResolver } from "@rmpsoftware/locus-core";
import { handleLocate } from "../src/tools/locate.js";
import { handleStatus } from "../src/tools/status.js";

it("reports real server progress in empty locate results and status", async () => {
  const rootPath = process.cwd();
  const configs = [{
    id: "busy", languageId: "typescript", extensions: [".ts"],
    command: process.execPath,
    args: [resolve(import.meta.dirname, "../../core/test/fixtures/fake-lsp.mjs"), "progress"],
  }];
  const manager = new LspManager(rootPath, configs);
  const ctx = { rootPath, configs, manager, resolver: new SymbolResolver({ rootPath }) };
  try {
    const result = await handleLocate(ctx, { name: "Missing" });
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    assert.match(text, /^status: no_results/);
    assert.match(text, /busy: Indexing \u2026/);
    assert.match(text, /Workspace indexing state is unknown/);

    const status = await handleStatus(ctx, {});
    const statusText = status.content[0]?.type === "text" ? status.content[0].text : "";
    assert.match(statusText, /Background work: Indexing \u2026; Loading projects/);

    const [client] = manager.getRunningClients();
    assert.ok(client);
    await client.workspaceSymbol("end-all");
    const after = await handleLocate(ctx, { name: "Missing" });
    const afterText = after.content[0]?.type === "text" ? after.content[0].text : "";
    assert.doesNotMatch(afterText, /Background work|report background work/);
    assert.match(afterText, /Workspace indexing state is unknown/);
  } finally {
    await manager.stopAll();
  }
});
