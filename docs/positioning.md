# Who is Locus for?

Locus is for people who work on code **through an AI agent** — developers, indie builders, technical PMs, and anyone using Cursor, Codex, or Claude Code who wants the agent to understand code structure, not just search for text.

## A good fit

- You already use an MCP-capable agent to read and edit files
- Your agent wastes time grepping for function names or reading whole files to find a definition
- You want go-to-definition, find-references, types, and error checking — the same things your IDE does — available to the agent
- You prefer a small, predictable setup (`npx`, seven tools) over a full IDE-inside-MCP stack

## Probably not for you

- You need **symbolic editing, automated refactors, or agent memory** inside MCP → look at [Serena](https://github.com/oraios/serena), which covers more IDE duties in one toolkit
- You only search logs, configs, or comments → grep is enough; Locus targets typed code symbols
- Your host already exposes equivalent semantic MCP tools with compact output → you may not need a second layer

Locus does not compete with Serena on breadth. It complements agents whose hosts already edit well — Cursor's Edit tool, Claude Code, Codex — and adds a focused navigation layer on top.

## What Locus gives your agent

Seven MCP tools for working with language servers (the same programs VS Code and Cursor use):

| Tool | What your agent can do |
|------|------------------------|
| `locate` | Find where a symbol is defined |
| `refs` | List every caller or implementation |
| `hover` | Read types and documentation |
| `diagnostics` | Catch compiler and linter errors after edits |
| `status` | Check whether language servers are ready |
| `rename` | Preview rename impact (your agent applies the edits) |
| `list_projects` | Discover configured project IDs, roots, and languages |

Install once with `npx @rmpsoftware/locus-mcp`. Your agent host spawns the server; you configure MCP once per project.

## Locus vs Serena (honest summary)

Both connect agents to language servers. The difference is scope:

| | Locus | Serena |
|---|-------|--------|
| Best for | Navigation + diagnostics on top of your host | Editing, refactoring, and memory inside MCP |
| Install | `npx @rmpsoftware/locus-mcp` | `uv tool install serena-agent` |
| MCP tools | 6 | Many |
| Symbolic editing | No — use host Edit | Yes |
| Agent memory | No | Yes |
| Built-in languages | TS/JS, Python, Go, Rust | 40+ |

Serena can be more efficient for large symbolic refactors — one MCP call to replace a function body vs many host-side edits. Choose Serena when you want that toolkit. Choose Locus when your host handles edits and you only need the map.

Running both at full tool surface is usually redundant. Pick based on whether you need navigation-only or full symbolic editing.

## Locus vs grep

Grep stays essential for strings, logs, and config files. Locus handles symbols — definitions, references, types — where the compiler knows the answer.

| Task | Use |
|------|-----|
| Where is `Foo.bar` defined? | Locus `locate` |
| Who calls this function? | Locus `refs` |
| Search for `"TODO"` in comments | Grep |
| Type at a cursor position | Locus `hover` |

Use both, not one instead of the other.

## Locus vs generic LSP bridges

Tools like **mcp-language-server** expose raw or variable LSP surfaces over MCP. That flexibility can mean large JSON payloads and unpredictable tool catalogs.

Locus offers a fixed seven-tool contract with compact output (`src/foo.ts:12:4: symbol | snippet`) and status codes agents can scan quickly. Choose a generic bridge when you need passthrough access to uncommon LSP methods. Choose Locus when you want a stable, agent-tuned navigation layer.

## Quick decision guide

**Choose Locus** when your host edits well and agents need definitions, references, types, and diagnostics on demand.

**Choose Serena** when you want symbolic editing, refactoring, and memory inside MCP.

**Choose grep only** when work is string search or non-code files with no language server.

## See also

- [Getting started](./getting-started.md) — setup in a few minutes
- [FAQ](./faq.md) — "Do I need to be a programmer?", "What's MCP?", and more
- [Comparison](./comparison.md) — feature table vs Serena, bridges, and grep
- [Usage guide](./usage.md) — MCP config for Cursor, Codex, Claude Code
