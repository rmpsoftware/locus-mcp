# Frequently Asked Questions

## Do I need to be a programmer?

No — not to set up or use Locus day to day. If you already work with an AI agent in Cursor, Codex, or Claude Code, you can follow the [getting started guide](./getting-started.md): install a language server, run two commands, paste an MCP config block, and ask your agent to use Locus.

You will touch a terminal for one-time setup (`init`, `check`) and copy JSON or TOML into your agent's settings. You do not need to write code or understand LSP internals.

If you are a developer, Locus works the same way — it just gives your agent the same go-to-definition and find-references intelligence your IDE already has.

## What's MCP?

**MCP** (Model Context Protocol) is a standard way for AI tools to call small, specialized helpers during a conversation. Instead of your agent guessing how code is structured, it can call tools like `locate` or `refs` on a server you configure once.

Think of MCP as a plug-in socket: Cursor, Codex, and Claude Code are the host; Locus is a plug-in that adds code navigation. You add Locus to your MCP config; the host starts it in the background; your agent calls its tools when it needs to find a definition or check for errors.

More setup detail: [usage guide](./usage.md)

## What is Locus?

Locus is an open-source MCP server that connects AI coding agents to language servers — the same programs IDEs use for go-to-definition, find references, types, and error checking. Your agent gets seven tools (`locate`, `refs`, `hover`, `diagnostics`, `status`, `rename`, `list_projects`) without wading through raw protocol JSON.

## How is Locus different from grep or ripgrep?

Grep finds text patterns. Locus finds **symbols** — functions, classes, types — with compiler accuracy. Use `locate` when you need the real definition; use grep for log lines, config keys, comments, and plain string search. They work well together.

## How does Locus compare to Serena?

[Serena](https://github.com/oraios/serena) is a broader MCP toolkit: symbolic editing, refactoring, and agent memory inside the protocol. Locus stays small — six navigation and diagnostics tools, `npx` install, no editing or memory.

Choose Locus when your host already edits files well and you want a thin layer for "where is this defined?" and "who calls this?". Choose Serena when you want symbolic body replacement, refactoring, and memory without relying on the host's Edit tool.

See [Who is Locus for?](./positioning.md) and [comparison.md](./comparison.md).

## Is Locus just a lighter Serena?

Not a drop-in substitute. Different scope, different install:

| | Locus | Serena |
|---|-------|--------|
| Install | `npx @rmpsoftware/locus-mcp` | `uv tool install serena-agent` |
| Tools | 6 (navigation + diagnostics) | Many (edit, memory, refactor, …) |
| Edits code | No — host Edit tool | Yes, inside MCP |
| Languages (built-in) | TS/JS, Python, Go, Rust | 40+ adapters |

## Which language servers are supported?

Built-in adapters: TypeScript/JavaScript (`typescript-language-server`), Python (`pyright-langserver`), Go (`gopls`), Rust (`rust-analyzer`). Override or extend via `locus.json` or `.lsp.json`. See [configuration.md](./configuration.md).

## Do I need language servers installed?

Yes. Locus asks language servers for answers — it does not parse code itself. Run `npx @rmpsoftware/locus-mcp check` in your project to verify binaries are on your PATH.

## What MCP tools does Locus expose?

Seven tools: `locate`, `refs`, `hover`, `diagnostics`, `status`, `rename`, `list_projects`. Full reference: [tools.md](./tools.md).

## Can I use Locus with Cursor, Codex, or Claude Code?

Yes. Add Locus to your MCP config with `npx @rmpsoftware/locus-mcp serve` and set `cwd` to your project root. Step-by-step: [usage.md](./usage.md).

## What config files does Locus read?

In order of discovery (walks up from cwd):

1. `locus.json` — project settings and server definitions
2. `.lsp.json` — Claude/Open Plugins compatibility

## Is Locus published on npm?

Yes: `@rmpsoftware/locus-mcp` (CLI + MCP server) and `@rmpsoftware/locus-core` (library). See [publishing.md](./publishing.md).

## How do I contribute?

See [CONTRIBUTING.md](../CONTRIBUTING.md) and [contributing.md](./contributing.md). Run `npm test` before opening a PR.

## What license is Locus under?

MIT — see [LICENSE](../LICENSE).
