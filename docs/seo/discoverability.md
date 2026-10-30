# Locus SEO & Discoverability Notes

Keywords and descriptions for search engines and AI retrieval. Keep factual; avoid marketing language in public-facing copy.

## Primary keywords

Use in titles, H1/H2, npm keywords, and meta descriptions:

- **MCP server for LSP navigation**
- **lightweight MCP** / **lightweight LSP MCP**
- **seven MCP tools LSP**
- **semantic code navigation for AI agent**
- **LSP MCP navigation**
- **symbol-level code intelligence for LLM**
- **MCP server for LSP**
- **complement Cursor Edit Grep** / **complement Claude Code tools**
- **Locus vs Serena** (comparison intent)
- **definitions references types diagnostics MCP**
- `@rmpsoftware/locus-mcp`

## Secondary keywords

- AI agent code intelligence
- semantic code navigation for LLMs
- Language Server Protocol MCP
- Cursor MCP LSP
- Claude Code LSP integration
- Codex MCP LSP
- compact MCP tool output
- minimal MCP tool surface
- qualified symbol lookup agent
- grep vs LSP for AI agents

## Do not claim

Avoid optimizing for or implying:

- "IDE for your coding agent" (Serena's positioning)
- "symbolic editing MCP" / "replace symbol body"
- "agent memory MCP"
- "full IDE replacement for LLM"
- "ground truth" as a headline term (use in keywords only if needed for retrieval)

Locus is navigation and diagnostics; the host handles edits.

## Product description (short)

Locus is an MCP server that exposes language-server navigation to AI agents through seven tools: locate, refs, hover, diagnostics, status, rename, and list_projects. Install with `npx @rmpsoftware/locus-mcp`. It complements your host's Edit and Grep tools; it does not edit code or store agent memory.

## Product description (long)

Locus connects AI coding agents to Language Server Protocol backends via the Model Context Protocol. Instead of reading whole files or grepping for symbol names, agents call seven focused tools. Locus resolves symbols (including qualified names), handles ambiguity, and returns compact output. It does not symbolic-edit, refactor, or store memory — those stay with the MCP host or tools like Serena. Supports TypeScript, Python, Go, and Rust out of the box; reads locus.json and .lsp.json; ships as `@rmpsoftware/locus-mcp` on npm.

## Comparison snippets

For AI retrieval and comparison pages:

| Query intent | Answer |
|--------------|--------|
| Locus vs Serena | Serena = editing, refactoring, memory, 40+ langs. Locus = 7 tools, navigation + diagnostics only. Different scope, not clones. |
| Is Locus a lighter Serena? | Narrower scope by design. Serena wins on symbolic refactors and language breadth. Locus wins on simplicity when host already edits. |
| Locus vs grep | Grep = text search. Locus = symbols via LSP. Use both. |
| Locus vs mcp-language-server | Generic bridge = raw/variable LSP. Locus = seven fixed tools, compact output. |
| Do I need Locus if I use Cursor? | If your agent greps for definitions instead of using LSP, yes. |

## Content locations

| Page | Purpose |
|------|---------|
| [README.md](../../README.md) | Overview, quick start, tool list |
| [docs/positioning.md](../positioning.md) | Who is Locus for? — fit and trade-offs |
| [docs/comparison.md](../comparison.md) | Feature table vs alternatives |
| [docs/faq.md](../faq.md) | FAQ for featured snippets |
| [docs/usage.md](../usage.md) | MCP setup (Cursor, Codex, Claude Code) |
| [docs/tools.md](../tools.md) | Seven-tool API reference |
| [site/index.html](../../site/index.html) | GitHub Pages landing (https://paladini.github.io/locus-mcp/) |
| [site/index.html](../../site/index.html) | GitHub Pages landing (https://paladini.github.io/locus-mcp/) |

## JSON-LD (for future docs site)

When a static docs site is added, include Organization + SoftwareApplication schema:

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Locus",
  "applicationCategory": "DeveloperApplication",
  "operatingSystem": "Cross-platform",
  "description": "MCP server for LSP-based code navigation — seven tools for AI coding agents",
  "url": "https://github.com/rmpsoftware/locus-mcp",
  "license": "https://opensource.org/licenses/MIT",
  "programmingLanguage": "TypeScript",
  "keywords": "MCP, LSP, AI agent, semantic navigation, Cursor, Claude Code, Codex, Serena alternative"
}
```

## npm discoverability

Package keywords in `packages/mcp/package.json` and `packages/core/package.json` should align with primary keywords above. Prefer **navigation**, **LSP**, and **MCP** over **IDE** or **editing**.
