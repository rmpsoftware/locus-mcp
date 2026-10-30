# Contributing to Locus

Thank you for your interest in contributing. This document covers development setup, testing, and the contribution workflow.

## Development setup

### Prerequisites

- Node.js 22+
- npm 10+
- Git
- Language servers for integration tests (optional but recommended):
  - `typescript-language-server` — `npm install -g typescript-language-server typescript`
  - `pyright-langserver` — `pip install pyright`

### Clone and install

```bash
git clone https://github.com/rmpsoftware/locus-mcp.git
cd locus-mcp
npm install
npm run build
```

### Project structure

```
packages/core/      @rmpsoftware/locus-core — LSP client, registry, symbols, format
packages/mcp/       @rmpsoftware/locus-mcp — MCP server + CLI (locus binary)
packages/adapters/  Cursor hooks + Claude skill stubs
evals/fixtures/     Integration test fixtures (TypeScript, Python)
docs/               User and contributor documentation
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile all workspaces |
| `npm run typecheck` | Type-check without emit |
| `npm test` | Run unit and integration tests |
| `npm run lint` | Lint via TypeScript (no emit) |

### Package-level tests

```bash
npm run test -w @rmpsoftware/locus-core
npm run test -w @rmpsoftware/locus-mcp
```

### CLI during development

```bash
node packages/mcp/dist/bin.js check
node packages/mcp/dist/bin.js init --cwd ./evals/fixtures/typescript
node packages/mcp/dist/bin.js warm --cwd ./evals/fixtures/typescript
node packages/mcp/dist/bin.js serve --cwd ./evals/fixtures/typescript
```

Integration tests skip automatically when LSP binaries are not on `PATH`.

## Writing tests

- Unit tests live in `packages/*/test/*.test.ts`
- Use Node.js built-in test runner (`node:test`) with `tsx` for TypeScript
- Mock `LspClient` for symbol resolver and MCP handler tests
- Use `packages/core/test/fixtures/fake-lsp.mjs` for LSP client/connection tests (mock JSON-RPC)
- Use real LSP only in `packages/mcp/test/integration.test.ts`
- Fixtures are under `evals/fixtures/`

### Test coverage areas

| Area | Package | Test files |
|------|---------|------------|
| Config (.lsp.json, locus.json) | core | `config.test.ts` |
| Registry | core | `format.test.ts`, `registry-extended.test.ts` |
| Symbol resolver | core | `resolver.test.ts` |
| Format layer | core | `format.test.ts`, `format-extended.test.ts` |
| LSP connection/client | core | `lsp-connection.test.ts`, `lsp-client.test.ts` |
| LSP connection (fake-lsp) | core | `lsp-connection-integration.test.ts` |
| LSP manager | core | `lsp-manager.test.ts` |
| MCP context | mcp | `context.test.ts` |
| MCP server wiring | mcp | `server.test.ts` |
| MCP tool schemas | mcp | `tools.test.ts` |
| MCP tool handlers | mcp | `handlers.test.ts` |
| Error handling | mcp | `helpers.test.ts`, `handlers.test.ts` |
| CLI commands | mcp | `cli.test.ts`, `cli-extended.test.ts` |
| Integration (optional) | mcp | `integration.test.ts` |

## Code style

- ESM modules with `.js` import extensions
- Strict TypeScript — match existing patterns
- Minimal diffs; no drive-by refactors
- User-facing strings in English
- Keep the MCP surface small; discuss new tools before adding them

## Branch naming

- `fix/description` — bug fixes
- `feat/description` — features (discuss new MCP tools first)
- `docs/description` — documentation
- `test/description` — test-only changes
- `chore/description` — CI, tooling, release

## Pull request process

1. Fork the repository and create a feature branch
2. Make your changes with tests where appropriate
3. Ensure `npm run build`, `npm run typecheck`, and `npm test` pass
4. Fill out the PR template checklist in `.github/PULL_REQUEST_TEMPLATE.md`
5. Open a PR with a clear description and test plan

See [CONTRIBUTING.md](../CONTRIBUTING.md) at the repo root for the full checklist.

## Reporting issues

Include:

- Node.js version (`node -v`)
- OS and shell
- Output of `locus check`
- MCP host (Cursor, Claude Code, etc.)
- Minimal reproduction steps

Use GitHub issue templates for bugs and feature requests.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](../LICENSE).
