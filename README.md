# Locus

[![npm version](https://img.shields.io/npm/v/@rmpsoftware/locus-mcp)](https://www.npmjs.com/package/@rmpsoftware/locus-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)
[![CI](https://github.com/rmpsoftware/locus-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/rmpsoftware/locus-mcp/actions/workflows/ci.yml)
[![Website](https://img.shields.io/badge/website-locus--mcp-1a4d4a)](https://paladini.github.io/locus-mcp/)

Locus gives your AI coding agent a map of your codebase. Whether you write code yourself or work through Cursor, Codex, or Claude Code, Locus connects your agent to the same go-to-definition and find-references intelligence your IDE uses — through [MCP](https://modelcontextprotocol.io) (Model Context Protocol), a standard plug-in layer for AI tools. Configure it once; your agent uses seven small tools to find symbols, trace callers, read types, and catch errors before you run tests.

## Why you might want this

- **Find the real definition** — Your agent can locate `UserService.authenticate` even when it is re-exported, overloaded, or buried in a large file — not just wherever the name appears as text.
- **See who calls what** — Before a refactor, list every reference to a function or class so nothing breaks silently.
- **Read types and docs** — Ask what a variable or parameter actually is, without guessing from variable names.
- **Catch errors early** — Surface compiler and linter problems right after an edit, instead of waiting for a full test run.

## Who this is for

Locus is for **AI-first builders**: developers, indie hackers, and PMs who work through an agent and want it to understand code structure, not just search strings.

It fits when your agent already edits files well (Cursor's Edit tool, Claude Code, Codex) and you want to add semantic navigation on top — without turning your setup into a second IDE inside MCP.

It is **not** for people who want symbolic editing, agent memory, or a full refactoring toolkit inside MCP. For that, look at [Serena](https://github.com/oraios/serena) — a broader option that does more inside the protocol. Locus stays intentionally small: seven tools, `npx` install, complements your host.

## Get started in 5 minutes

1. **Install a language server** (if you do not have one yet) — for TypeScript/JavaScript: `npm install -g typescript-language-server typescript`. See [Installing language servers](docs/getting-started.md#step-2-install-language-servers) for Python, Go, and Rust.
2. **Run one-time setup** in your project folder:
   ```bash
   npx @rmpsoftware/locus-mcp init
   npx @rmpsoftware/locus-mcp check
   ```
3. **Add Locus to your agent's MCP config** — MCP is how AI hosts call helper tools like Locus; copy a block from [Copy-paste configs](#copy-paste-configs) below and set `cwd` to your project's absolute path.
4. **Reload MCP** — restart Cursor, reload Codex, or reopen Claude Code so the new server appears.
5. **Try a prompt** — ask your agent: *"Use Locus to find where `UserService` is defined and list all references."* If it calls the `locate` and `refs` tools, you are set.

**Requirements:** Node.js 22+. Language servers on your `PATH` for the languages you use.

## Copy-paste configs

Your agent host spawns Locus automatically — you never run `serve` by hand during normal use.

### Cursor

Create or edit `.cursor/mcp.json` in your project (or global Cursor MCP settings):

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

### Codex

Add to `~/.codex/config.toml` (global) or `.codex/config.toml` (project):

```toml
[mcp_servers.locus]
command = "npx"
args = ["-y", "@rmpsoftware/locus-mcp", "serve"]
cwd = "/absolute/path/to/your/project"
```

For a project-scoped config, you can use `cwd = "."` instead.

### Claude Code

Add to Claude Code MCP settings:

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

More detail (local dev, troubleshooting): [docs/usage.md](docs/usage.md)

## Example prompts to try

Paste these into your agent after Locus is configured:

- *"Find where `UserService` is defined. Use Locus `locate`, not grep."*
- *"Before we rename `parseConfig`, use Locus to list every file that calls it."*
- *"What type does `response.data` have in `src/api/handler.ts`? Use Locus `hover`."*
- *"After your edits, run Locus diagnostics on the files you changed and fix any errors."*
- *"Check Locus `status` — are the language servers ready?"*

## What Locus does NOT do

- **Edit your code** — Your agent's Edit/Write tools still apply changes. Locus only reads structure and diagnostics.
- **Replace grep** — Grep is still best for log lines, config keys, comments, and plain text search.
- **Remember things between sessions** — No agent memory store; each session starts fresh.
- **Run refactors for you** — `rename` previews impact; your agent applies the actual edits.
- **Expose every LSP feature** — Seven focused tools only, not a full IDE protocol passthrough.
- **Compete with large toolkits** — If you need symbolic body replacement, memory, and 40+ languages in one MCP stack, consider [Serena](https://github.com/oraios/serena) instead.

## Tools at a glance

| Tool | What it does |
|------|----------------|
| [`locate`](docs/tools.md#locate) | Find a symbol by name or list symbols in a file |
| [`refs`](docs/tools.md#refs) | All references or implementations at a position |
| [`hover`](docs/tools.md#hover) | Type information and documentation |
| [`diagnostics`](docs/tools.md#diagnostics) | File or workspace errors and warnings |
| [`status`](docs/tools.md#status) | Language-server readiness and missing binaries |
| [`rename`](docs/tools.md#rename) | Preview a rename (dry-run; apply via your agent) |
| [`list_projects`](docs/tools.md#list_projects) | Discover configured project IDs, roots, and languages |

## Learn more

| Guide | Description |
|-------|-------------|
| [Usage guide](docs/usage.md) | Step-by-step setup, workflows, troubleshooting |
| [Getting started](docs/getting-started.md) | First-time setup — no LSP knowledge required |
| [FAQ](docs/faq.md) | Do I need to be a programmer? What's MCP? |
| [Who is Locus for?](docs/positioning.md) | Fit, scope, and when to pick alternatives |
| [Comparison](docs/comparison.md) | Locus vs Serena, bridges, and grep |
| [Tools reference](docs/tools.md) | All seven MCP tools with examples |
| [Configuration](docs/configuration.md) | `locus.json`, language servers |
| [Website](https://paladini.github.io/locus-mcp/) | Lightweight positioning and quick overview |

## License

[MIT](LICENSE)

## Standalone JavaScript bundle

Run `npm ci` and `npm run bundle` to build `packages/mcp/dist/locus.js` with Rolldown.
The normal `npm run build` also produces this bundle. Copy the single file wherever
needed and run it with Node.js 22 or newer:

```sh
node /path/to/locus.js serve --cwd /path/to/project
```

The bundle includes the MCP server and its JavaScript dependencies; no
`node_modules` directory is needed at runtime. Language-server executables such as
`csharp-ls` must still be installed separately and available on `PATH` (or configured
with an absolute command path in `locus.json`).
