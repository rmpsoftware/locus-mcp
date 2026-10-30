import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findConfigFile,
  loadConfig,
  createRegistry,
  detectProjectLanguages,
  configToJson,
  generateDefaultConfig,
} from "../src/index.js";

describe("findConfigFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-config-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("finds locus.json", () => {
    writeFileSync(join(tempDir, "locus.json"), '{"root":"."}');
    assert.equal(findConfigFile(tempDir), join(tempDir, "locus.json"));
  });

  it("finds .lsp.json for Claude/Open Plugins compat", () => {
    writeFileSync(join(tempDir, ".lsp.json"), '{"languageServer":{"command":"custom-lsp"}}');
    assert.equal(findConfigFile(tempDir), join(tempDir, ".lsp.json"));
  });

  it("ignores locus.toml and prefers locus.json over .lsp.json", () => {
    writeFileSync(join(tempDir, "locus.toml"), "invalid TOML");
    writeFileSync(join(tempDir, "locus.json"), '{"root":".","warm":["server"]}');
    writeFileSync(join(tempDir, ".lsp.json"), "{}");
    assert.equal(findConfigFile(tempDir), join(tempDir, "locus.json"));
    assert.deepEqual(loadConfig(tempDir).config.warm, ["server"]);
  });

  it("ignores a nested locus.toml when discovering a parent JSON config", () => {
    const sub = join(tempDir, "nested");
    mkdirSync(sub);
    writeFileSync(join(sub, "locus.toml"), "invalid TOML");
    writeFileSync(join(tempDir, "locus.json"), '{"root":"."}');
    assert.equal(findConfigFile(sub), join(tempDir, "locus.json"));
  });

  it("walks up to parent directory", () => {
    const sub = join(tempDir, "src", "nested");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(tempDir, "locus.json"), '{"root":"."}');
    assert.equal(findConfigFile(sub), join(tempDir, "locus.json"));
  });
});

describe("loadConfig .lsp.json compatibility", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-lspjson-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("resolves project roots relative to the configuration and retains ignored directories", () => {
    const nested = join(tempDir, "nested");
    mkdirSync(nested);
    writeFileSync(join(tempDir, "locus.json"), JSON.stringify({
      root: "project", servers: [{
        id: "ts", languageId: "typescript", extensions: [".ts"], command: "mock",
        ignoreDirectories: ["generated"],
        autoOpenFiles: ["src/main.ts"],
        initSleep: 2000,
      }],
    }));
    const { rootPath, config } = loadConfig(nested);
    assert.equal(rootPath, join(tempDir, "project"));
    assert.deepEqual(config.servers?.[0]?.ignoreDirectories, ["generated"]);
    assert.deepEqual(createRegistry(config).getById("ts")?.autoOpenFiles, ["src/main.ts"]);
    assert.equal(createRegistry(config).getById("ts")?.initSleep, 2000);
  });

  it("converts languageServer block to server entry", () => {
    writeFileSync(
      join(tempDir, ".lsp.json"),
      JSON.stringify({
        languageServer: {
          command: "custom-ts-lsp",
          args: ["--stdio"],
          autoOpenFiles: ["src/main.ts"],
          initSleep: 1500,
          extensionToLanguage: { ts: "typescript", ".tsx": "typescriptreact" },
        },
      }),
    );

    const { config, rootPath } = loadConfig(tempDir);
    assert.equal(rootPath, tempDir);
    assert.ok(config.servers?.some((s) => s.command === "custom-ts-lsp"));
    assert.ok(config.servers?.some((s) => s.extensions.includes(".ts")));
    assert.deepEqual(config.servers?.find((s) => s.command === "custom-ts-lsp")?.autoOpenFiles, ["src/main.ts"]);
    assert.equal(config.servers?.find((s) => s.command === "custom-ts-lsp")?.initSleep, 1500);
  });

  it("merges servers array from .lsp.json", () => {
    writeFileSync(
      join(tempDir, ".lsp.json"),
      JSON.stringify({
        servers: [
          {
            id: "ruby",
            languageId: "ruby",
            extensions: [".rb"],
            command: "solargraph",
            args: ["stdio"],
            autoOpenFiles: ["lib/app.rb"],
            initSleep: 500,
          },
        ],
      }),
    );

    const { config } = loadConfig(tempDir);
    assert.ok(config.servers?.some((s) => s.id === "ruby"));
    assert.ok(config.servers?.some((s) => s.command === "solargraph"));
    assert.ok(config.servers?.every((s) => s.id !== "ruby" || s.autoOpenFiles?.[0] === "lib/app.rb"));
    assert.ok(config.servers?.every((s) => s.id !== "ruby" || s.initSleep === 500));
  });

  it("loads locus.json with warm array", () => {
    writeFileSync(join(tempDir, "locus.json"), '{"root":".","warm":["typescript","python"]}');
    const { config } = loadConfig(tempDir);
    assert.deepEqual(config.warm, ["typescript", "python"]);
  });

  it("throws on invalid locus.json", () => {
    writeFileSync(join(tempDir, "locus.json"), "{ not valid json");
    assert.throws(() => loadConfig(tempDir), SyntaxError);
  });

});

describe("createRegistry", () => {
  it("uses builtins when servers array is empty", () => {
    const registry = createRegistry({});
    assert.ok(registry.getByExtension(".ts"));
    assert.ok(registry.getByExtension(".py"));
  });

  it("uses custom servers when provided", () => {
    const registry = createRegistry({
      servers: [
        {
          id: "custom",
          languageId: "typescript",
          extensions: [".ts"],
          command: "my-lsp",
        },
      ],
    });
    const server = registry.getByExtension(".ts");
    assert.equal(server?.command, "my-lsp");
  });

  it("returns undefined for unknown extension", () => {
    const registry = createRegistry({});
    assert.equal(registry.getByExtension(".xyz"), undefined);
  });
});

describe("detectProjectLanguages", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "locus-detect-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("detects typescript from tsconfig.json", () => {
    writeFileSync(join(tempDir, "tsconfig.json"), "{}");
    const langs = detectProjectLanguages(tempDir);
    assert.ok(langs.includes("typescript"));
  });

  it("detects python from pyproject.toml", () => {
    writeFileSync(join(tempDir, "pyproject.toml"), "[project]\nname = 'test'\n");
    const langs = detectProjectLanguages(tempDir);
    assert.ok(langs.includes("python"));
  });

  it("returns empty array for unknown project", () => {
    assert.deepEqual(detectProjectLanguages(tempDir), []);
  });
});

describe("config serialization", () => {
  it("configToJson produces valid JSON", () => {
    const config = generateDefaultConfig(process.cwd());
    const parsed = JSON.parse(configToJson(config));
    assert.ok(parsed.root);
    assert.ok(Array.isArray(parsed.servers));
  });
});
