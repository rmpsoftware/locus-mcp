# Locus vs Alternatives

A factual comparison to help you pick the right MCP + code-intelligence setup for your agent.

## At a glance

| | **Locus** | **Serena** | **mcp-language-server** | **cclsp** |
|---|-----------|------------|-------------------------|-----------|
| Primary goal | Semantic navigation for agents | Full agent IDE (edit + refactor + memory) | Generic LSP-over-MCP | Host-native LSP for Claude Code |
| Install | `npx @rmpsoftware/locus-mcp` (Node.js 22+) | `uv tool install serena-agent` (Python) | Community packages | Host plugin |
| MCP tools | 6 fixed tools | Many | Variable / generic | Host-specific |
| Edits code | No — your agent edits | Yes — symbolic editing tools | Depends | Limited |
| Agent memory | No | Yes | No | No |
| Output format | Compact line-oriented text | Mixed | Often verbose JSON | Mixed |
| Works across hosts | Cursor, Codex, Claude Code, … | MCP hosts | MCP hosts | Claude Code only |
| Built-in languages | 4 (TS/JS, Python, Go, Rust) | 40+ | Varies | Varies |
| Config | locus.toml, locus.json, .lsp.json | Project-specific | Varies | cclsp config |
| License | MIT | MIT | Varies | Check upstream |

## Locus

**Choose Locus when** your agent host already handles edits and search, and you want a thin semantic layer on top.

**You get:**

- Seven documented tools: `locate`, `refs`, `hover`, `diagnostics`, `status`, `rename`, `list_projects`
- Symbol resolution with qualified names and clear status codes
- Compact output agents can scan quickly (`src/foo.ts:12:4: symbol | snippet`)
- `.lsp.json` compatibility for portable config
- CLI helpers: `init`, `check`, `warm`, `serve`

**You do not get:**

- Symbolic editing or automated refactors
- Agent memory between sessions
- Passthrough to arbitrary LSP methods
- Rename apply (`rename` previews only; your agent applies edits)

## Serena

**Choose Serena when** you want editing, refactoring, and memory inside MCP — a broader toolkit closer to what an IDE would do for the agent.

**You get:**

- Symbolic editing (`find_symbol`, `replace_symbol_body`, `insert_after_symbol`, …)
- Agent memory for long sessions
- 40+ languages via LSP backends
- Context profiles per host

**Trade-offs:**

- Larger tool surface — more overlap with capable hosts like Cursor
- Python/`uv` install vs Node.js/`npx` for Locus
- Can be more efficient for large symbolic refactors than many host-side edits

**Compared to Locus:** Serena covers editing and memory; Locus covers navigation and diagnostics only. If Cursor or Claude Code already edits well for you, Locus adds semantics without a second IDE inside MCP.

## mcp-language-server

**Choose when** you need generic LSP-over-MCP access or uncommon LSP methods.

**Compared to Locus:** Generic bridges often expose raw LSP methods or large JSON payloads. Locus adds a symbol layer, formatted output, status codes, and a fixed seven-tool contract tuned for agents.

## cclsp

**Choose when** you use Claude Code and want host-native LSP without a separate MCP server.

**Compared to Locus:** cclsp is built into one host; Locus is MCP-native and works across Cursor, Claude Code, Codex, and other MCP hosts with the same config.

## Which tool for which job?

| Task | Best option |
|------|-------------|
| Find symbol definition | Locus `locate` |
| Find all references | Locus `refs` |
| Search string / regex | Host grep / ripgrep |
| Edit a file | Host Edit / Write tools |
| Type info at a position | Locus `hover` |
| Compiler errors after edit | Locus `diagnostics` |
| Rename impact preview | Locus `rename` |
| Replace function body symbolically | Serena (or host Edit) |
| Remember context across sessions | Serena |

## Can I use Locus and Serena together?

Technically yes, but usually unnecessary — both connect to LSP and overlap on navigation. Most people pick one based on whether they need editing inside MCP (Serena) or navigation-only on top of a capable host (Locus).

## See also

- [Who is Locus for?](./positioning.md)
- [FAQ](./faq.md)
- [Getting started](./getting-started.md)
- [Tools reference](./tools.md)
