# Locus Design Notes

## Architecture

See the approved plan for full market analysis and positioning.

### Layers

1. **lsp-client** — JSON-RPC stdio transport, document sync, diagnostic debounce
2. **registry** — declarative language server configs
3. **symbol-layer** — name-first resolution via workspace/document symbols
4. **format** — compact LLM output with discriminated status codes
5. **mcp-server** — 7 curated tools
6. **adapters** — host-specific hooks and skills

## Error taxonomy

| Status | Meaning |
|--------|---------|
| `ok` | Success |
| `no_results` | Valid query, nothing found |
| `server_starting` | LSP still indexing — retry |
| `server_unavailable` | Binary missing or crashed |
| `ambiguous_symbol` | Multiple matches — disambiguate |
| `file_not_found` | No file matches the given path or name |
| `ambiguous_file` | Multiple files match — retry with one of the listed paths |

## Comparison matrix

| Capability | LSP bridges | Serena | Locus |
|------------|-------------|--------|-------|
| ≤7 tools | rare | no | yes |
| Symbol-first | rare | yes | yes |
| Compact output | rare | mixed | yes |
| Host hooks | no | no | yes (v0.2) |
