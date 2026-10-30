# @rmpsoftware/locus-mcp

**Locus** is an MCP server that gives AI coding agents semantic code intelligence — the same go-to-definition, find-references, type information, and diagnostics your IDE uses, through seven focused tools.

[![npm version](https://img.shields.io/npm/v/@rmpsoftware/locus-mcp)](https://www.npmjs.com/package/@rmpsoftware/locus-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/rmpsoftware/locus-mcp/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)

## What problem does this solve?

AI agents are great at reading and editing files, but text search alone is not enough for typed code:

| Problem | Without Locus | With Locus |
|---------|---------------|------------|
| Find a symbol definition | Grep returns every string match | `locate` finds the real definition |
| Refactor safely | Easy to miss callers | `refs` lists every reference |
| Understand types | Guess from variable names | `hover` returns compiler types and docs |
| Catch errors after edits | Wait for tests or manual build | `diagnostics` surfaces compiler/linter issues |

Locus connects your agent to **language servers** (TypeScript, Python, Go, Rust, and more) through [MCP](https://modelcontextprotocol.io) — a standard plug-in layer for AI tools like Cursor, Claude Code, and Codex.

## Who is this for?

- Developers and builders who work **through an AI agent** and want semantic navigation, not just grep
- Teams using **Cursor**, **Claude Code**, **Codex**, or any MCP-capable host
- People who want a **small, predictable** setup (`npx`, seven tools) instead of a full IDE-inside-MCP stack

Locus does **not** replace your agent's edit tools, grep for plain text, or provide agent memory. It complements hosts that already edit well with a focused navigation layer.

## Quick start

### 1. Prerequisites

- **Node.js 22+**
- A **language server** for your project's language(s)

```bash
# TypeScript / JavaScript
npm install -g typescript-language-server typescript

# Python
pip install pyright

# Go
go install golang.org/x/tools/gopls@latest

# Rust
rustup component add rust-analyzer
```

### 2. One-time project setup

Run in your **project root**:

```bash
npx @rmpsoftware/locus-mcp init
npx @rmpsoftware/locus-mcp check
```

- `init` — creates a `locus.json` config file
- `check` — verifies language-server binaries are installed and on your PATH

### 3. Add to your agent (MCP config)

Replace `/absolute/path/to/your/project` with your real project path.

**Cursor** — `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "locus": {
      "command": "npx",
      "args": ["-y", "@rmpsoftware/locus-mcp", "serve"],
      "cwd": "/absolute/path/to/your/project"
    }
  }
}
```

**Claude Code / Codex** — same JSON shape in your host's MCP settings.

Reload MCP servers or restart your agent host after saving.

### 4. Try it

Ask your agent:

> Use Locus to find where `UserService` is defined and list all references.

Your agent should call the `locate` and `refs` MCP tools — not run grep in a terminal.

## CLI commands

| Command | Description |
|---------|-------------|
| `locus serve` | Start the MCP server (used by your agent host) |
| `locus init` | Create config files in the current directory |
| `locus check` | Verify language-server binaries are available |
| `locus warm` | Pre-start language servers before a long session |

```bash
npx @rmpsoftware/locus-mcp --help
```

## MCP tools

Locus exposes **seven tools**. Query tools return compact text with a leading `status:` line; `list_projects` returns a JSON array.

| Tool | What it does |
|------|----------------|
| `locate` | Find a symbol by name or list symbols in a file |
| `refs` | Find all references or implementations at a position |
| `hover` | Get type information and documentation |
| `diagnostics` | Get compiler/linter errors for a file or workspace |
| `status` | Check language-server readiness and missing binaries |
| `rename` | Preview a rename (dry-run by default; agent applies edits) |
| `list_projects` | Discover configured project IDs, roots, and languages |

Use the optional `project` and `lang` parameters on navigation and diagnostics tools to select server configurations by ID and language.

### Example prompts

- *"Find where `UserService` is defined. Use Locus `locate`, not grep."*
- *"Before we rename `parseConfig`, use Locus to list every file that calls it."*
- *"What type does `response.data` have? Use Locus `hover`."*
- *"After your edits, run Locus diagnostics on the files you changed."*

## What Locus does NOT do

- **Edit code** — your agent's Edit/Write tools apply changes; Locus only reads structure
- **Replace grep** — grep is still best for logs, config keys, comments, and plain text
- **Remember between sessions** — no agent memory store
- **Run refactors automatically** — `rename` previews impact; your agent applies edits
- **Expose every LSP feature** — seven focused tools only

## Configuration

Locus discovers config by walking up from the project root:

| File | Purpose |
|------|---------|
| `locus.json` | Project root, warm servers, and language server definitions |
| `.lsp.json` | Compatibility with Claude Code Open Plugins |

Run `locus init` to generate defaults. Built-in servers cover TypeScript/JavaScript, Python, Go, and Rust when no custom config is provided.

## Install options

```bash
# Recommended — no global install
npx @rmpsoftware/locus-mcp init

# Global install
npm install -g @rmpsoftware/locus-mcp

# From GitHub Packages
npm install @rmpsoftware/locus-mcp --registry https://npm.pkg.github.com
```

Requires a GitHub PAT with `read:packages` for GitHub Packages installs.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `check` reports MISSING binary | Install that language server; ensure it is on your PATH |
| Agent uses grep instead of Locus | Remind it: *"Use the Locus MCP tool `locate`, not grep."* |
| `server_starting` in tool output | Wait a few seconds and retry, or run `locus warm` |
| MCP server not listed in host | Confirm `cwd` is an absolute path to your project root; reload MCP |

## Documentation

Full guides live in the [Locus repository](https://github.com/rmpsoftware/locus-mcp):

| Guide | Description |
|-------|-------------|
| [Getting started](https://github.com/rmpsoftware/locus-mcp/blob/main/docs/getting-started.md) | First-time setup |
| [Usage guide](https://github.com/rmpsoftware/locus-mcp/blob/main/docs/usage.md) | Host setup and workflows |
| [Tools reference](https://github.com/rmpsoftware/locus-mcp/blob/main/docs/tools.md) | All seven tools with examples |
| [Configuration](https://github.com/rmpsoftware/locus-mcp/blob/main/docs/configuration.md) | `locus.json`, language servers |
| [FAQ](https://github.com/rmpsoftware/locus-mcp/blob/main/docs/faq.md) | Common questions |
| [Comparison](https://github.com/rmpsoftware/locus-mcp/blob/main/docs/comparison.md) | Locus vs Serena, grep, LSP bridges |

## Related packages

- [`@rmpsoftware/locus-core`](https://www.npmjs.com/package/@rmpsoftware/locus-core) — LSP client library used by this server (for library authors and contributors)

## License

[MIT](https://github.com/rmpsoftware/locus-mcp/blob/main/LICENSE)
