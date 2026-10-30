# Claude Code Skill (stub)

Guidance for when to use Locus vs Grep.

## When to use Locus

- Finding definitions, references, implementations
- Type information and hover docs
- Compiler/linter diagnostics after edits
- Symbol rename preview

## When to use Grep

- Free-text search across codebase
- Comments, strings, config values
- Regex patterns

## MCP registration

Add to Claude Code settings:

```json
{
  "mcpServers": {
    "locus": {
      "command": "npx",
      "args": ["-y", "@rmpsoftware/locus-mcp", "serve"],
      "cwd": "/path/to/project"
    }
  }
}
```

## Status

MVP stub — full SKILL.md shipped in v0.2.
