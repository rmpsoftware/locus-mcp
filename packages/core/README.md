# @rmpsoftware/locus-core

Core library for [Locus](https://github.com/rmpsoftware/locus-mcp) — LSP client, language-server registry, symbol resolution, and agent-friendly output formatting.

[![npm version](https://img.shields.io/npm/v/@rmpsoftware/locus-core)](https://www.npmjs.com/package/@rmpsoftware/locus-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/rmpsoftware/locus-mcp/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)

> **Looking to use Locus with your AI agent?** Install [`@rmpsoftware/locus-mcp`](https://www.npmjs.com/package/@rmpsoftware/locus-mcp) instead — it includes the MCP server, CLI, and everything you need as an end user.

## What is this package?

`@rmpsoftware/locus-core` is the **engine** behind Locus. It provides reusable building blocks for connecting to language servers and turning LSP responses into compact, agent-readable text.

Use this package when you are:

- Building a custom MCP server or agent tool on top of LSP
- Contributing to the Locus monorepo
- Integrating language-server intelligence into Node.js tooling

End users who want MCP tools in Cursor or Claude Code should use **`@rmpsoftware/locus-mcp`**, not this package directly.

## What problems does it solve?

Building LSP integrations from scratch means handling process spawning, JSON-RPC, document sync, symbol parsing, and output formatting. This library wraps that complexity into focused modules:

| Module | Problem it solves |
|--------|-------------------|
| **LSP client** | Spawn, connect, and communicate with language servers over stdio |
| **Registry** | Declarative language-server configs with built-in defaults |
| **Symbol layer** | Resolve qualified names and disambiguate workspace symbols |
| **Format** | Convert LSP results to compact `path:line:col` text for agents |
| **Config** | Load `locus.json` and `.lsp.json` project configs |

## What's included

### LSP client (`lsp-client/`)

- `LspConnection` — JSON-RPC over stdio
- `LspClient` — document lifecycle, symbols, references, hover, rename, diagnostics
- `LspManager` — manage multiple language servers for a workspace

### Registry (`registry/`)

- Built-in defaults for TypeScript/JavaScript, Python, Go, and Rust
- Custom server definitions via project config

### Symbol layer (`symbol-layer/`)

- Qualified name parsing (`MyClass.method`)
- Workspace and document symbol resolution

### Format (`format/`)

- Agent-friendly output for locations, hover, diagnostics, rename previews, and status
- Discriminated status codes (`ok`, `ambiguous_symbol`, `server_unavailable`, etc.)

### Config (`config/`)

- Discover and load `locus.json`, `.lsp.json`
- Project language detection from markers (`tsconfig.json`, `pyproject.toml`, etc.)

## Installation

```bash
npm install @rmpsoftware/locus-core
```

From GitHub Packages:

```bash
npm install @rmpsoftware/locus-core --registry https://npm.pkg.github.com
```

Requires Node.js **22+**.

## Usage

### Load project config

```typescript
import { findConfigFile, loadConfig, createRegistry } from "@rmpsoftware/locus-core";

const configPath = findConfigFile(process.cwd());
const { config, rootPath } = loadConfig(process.cwd());

console.log(rootPath);        // resolved project root
console.log(config.servers);  // language server definitions

const registry = createRegistry(config);
const tsServer = registry.getById("typescript");

console.log(tsServer?.command); // e.g. "typescript-language-server"
console.log(tsServer?.warm);    // whether locus warm pre-starts this server
```

### Connect to a language server

```typescript
import { LspClient, formatLocations } from "@rmpsoftware/locus-core";

const client = new LspClient({
  rootPath: "/path/to/project",
  serverConfig: {
    id: "typescript",
    languageId: "typescript",
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    command: "typescript-language-server",
    args: ["--stdio"],
  },
});

await client.start();
await client.didOpen("src/index.ts");

const symbols = await client.workspaceSymbol("Greeter");
const refs = await client.references("src/index.ts", 4, 10);

const lines = formatLocations(refs, "/path/to/project");
// ["src/index.ts:12:4: ...", ...]

await client.stop();
```

## Built-in language servers

When no custom `servers` config is provided, defaults are used:

| Language | Server | Extensions |
|----------|--------|------------|
| TypeScript / JavaScript | `typescript-language-server` | `.ts`, `.tsx`, `.js`, `.jsx` |
| Python | `pyright-langserver` | `.py`, `.pyi` |
| Go | `gopls` | `.go` |
| Rust | `rust-analyzer` | `.rs` |

Language servers must be installed separately and available on your `PATH`.

## API surface

The package exports everything from:

```typescript
export * from "./lsp-client/types.js";
export * from "./lsp-client/connection.js";
export * from "./lsp-client/client.js";
export * from "./lsp-client/manager.js";
export * from "./registry/registry.js";
export * from "./registry/builtins.js";
export * from "./symbol-layer/resolver.js";
export * from "./format/format.js";
export * from "./config/config.js";
```

TypeScript definitions are included in the published package (`dist/*.d.ts`).

## Relationship to @rmpsoftware/locus-mcp

```
@rmpsoftware/locus-core   ←  LSP client, registry, symbols, format, config
        ↑
@rmpsoftware/locus-mcp    ←  MCP server, CLI, seven agent tools
```

`@rmpsoftware/locus-mcp` depends on this package and adds the MCP protocol layer, tool handlers, and CLI commands (`serve`, `init`, `check`, `warm`).

## Documentation

| Resource | Link |
|----------|------|
| End-user setup | [Getting started](https://github.com/rmpsoftware/locus-mcp/blob/main/docs/getting-started.md) |
| Configuration | [Configuration guide](https://github.com/rmpsoftware/locus-mcp/blob/main/docs/configuration.md) |
| Architecture | [Design doc](https://github.com/rmpsoftware/locus-mcp/blob/main/docs/design.md) |
| Contributing | [Contributing guide](https://github.com/rmpsoftware/locus-mcp/blob/main/CONTRIBUTING.md) |

## License

[MIT](https://github.com/rmpsoftware/locus-mcp/blob/main/LICENSE)
