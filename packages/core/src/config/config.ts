import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BUILTIN_SERVERS } from "../registry/builtins.js";
import type { LanguageServerConfig } from "../registry/registry.js";
import { LanguageServerRegistry } from "../registry/registry.js";

export interface LocusConfig {
  root?: string;
  servers?: LanguageServerConfig[];
}

export interface LspJsonManifest {
  languageServer?: {
    description?: string;
    warm?: boolean;
    command?: string;
    args?: string[];
    autoOpenFiles?: string[];
    initSleep?: number;
    extensionToLanguage?: Record<string, string>;
  };
  servers?: Array<{
    id?: string;
    description?: string;
    warm?: boolean;
    languageId?: string;
    extensions?: string[];
    command?: string;
    args?: string[];
    autoOpenFiles?: string[];
    initSleep?: number;
  }>;
}

const CONFIG_FILES = ["locus.json", ".lsp.json"];

export function findConfigFile(startDir: string): string | undefined {
  let dir = resolve(startDir);

  while (true) {
    for (const name of CONFIG_FILES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  return undefined;
}

export function loadConfig(cwd: string = process.cwd()): { config: LocusConfig; configPath?: string; rootPath: string } {
  const configPath = findConfigFile(cwd);
  let config: LocusConfig = {};

  if (configPath) {
    const raw = readFileSync(configPath, "utf8");
    config = JSON.parse(raw) as LocusConfig;

    if ("warm" in config) {
      throw new Error("Top-level warm is no longer supported; set warm on each server instead");
    }

    if (configPath.endsWith(".lsp.json")) {
      config = convertLspJson(JSON.parse(raw) as LspJsonManifest, config);
    }

    for (const server of config.servers ?? []) {
      if (server.warm !== undefined && typeof server.warm !== "boolean") {
        throw new Error(`Invalid warm flag for server "${server.id}": expected a boolean`);
      }
    }
  }

  const rootPath = resolve(configPath ? resolve(configPath, "..") : cwd, config.root ?? ".");
  return { config, configPath, rootPath };
}

export function createRegistry(config: LocusConfig): LanguageServerRegistry {
  const servers = config.servers?.length ? config.servers : BUILTIN_SERVERS;
  return new LanguageServerRegistry({ servers });
}

function convertLspJson(manifest: LspJsonManifest, existing: LocusConfig): LocusConfig {
  const servers: LanguageServerConfig[] = existing.servers ?? [...BUILTIN_SERVERS];

  if (manifest.servers) {
    for (const entry of manifest.servers) {
      if (!entry.command || !entry.languageId) continue;
      servers.push({
        id: entry.id ?? entry.languageId,
        description: entry.description,
        warm: entry.warm,
        languageId: entry.languageId,
        extensions: entry.extensions ?? [],
        command: entry.command,
        args: entry.args,
        autoOpenFiles: entry.autoOpenFiles,
        initSleep: entry.initSleep,
      });
    }
  }

  if (manifest.languageServer?.command) {
    const extMap = manifest.languageServer.extensionToLanguage ?? {};
    const extensions = Object.keys(extMap).map((e) => (e.startsWith(".") ? e : `.${e}`));
    const languageId = Object.values(extMap)[0] ?? "unknown";

    servers.push({
      id: languageId,
      description: manifest.languageServer.description,
      warm: manifest.languageServer.warm,
      languageId,
      extensions,
      command: manifest.languageServer.command,
      args: manifest.languageServer.args,
      autoOpenFiles: manifest.languageServer.autoOpenFiles,
      initSleep: manifest.languageServer.initSleep,
    });
  }

  return { ...existing, servers };
}

export function detectProjectLanguages(rootPath: string): string[] {
  const markers: Array<[string, string]> = [
    ["tsconfig.json", "typescript"],
    ["package.json", "typescript"],
    ["pyproject.toml", "python"],
    ["requirements.txt", "python"],
    ["go.mod", "go"],
    ["Cargo.toml", "rust"],
  ];

  const found = new Set<string>();
  for (const [file, lang] of markers) {
    if (existsSync(join(rootPath, file))) {
      found.add(lang);
    }
  }

  return [...found];
}

export function generateDefaultConfig(rootPath: string): LocusConfig {
  const languages = detectProjectLanguages(rootPath);
  const servers = BUILTIN_SERVERS.filter(
    (s) => languages.length === 0 || languages.includes(s.languageId) || s.languageId === "typescript",
  ).map((s) => ({
    ...s,
    warm: languages.length ? languages.includes(s.languageId) : s.languageId === "typescript",
  }));

  return {
    root: rootPath,
    servers,
  };
}

export function configToJson(config: LocusConfig): string {
  return JSON.stringify(config, null, 2);
}
