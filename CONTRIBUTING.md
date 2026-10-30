# Contributing

We welcome contributions to Locus. Please read this guide before opening a pull request.

## Code of conduct

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). Be respectful and constructive. Focus on technical merit and user impact.

## How to contribute

1. **Check existing issues** — avoid duplicate work
2. **Fork and branch** — use descriptive branch names (see below)
3. **Develop** — follow the setup in [docs/contributing.md](docs/contributing.md)
4. **Test** — run `npm run build`, `npm run typecheck`, and `npm test`
5. **Submit a PR** — use the PR template checklist

## Branch naming

Use short, descriptive prefixes:

| Prefix | Use for |
|--------|---------|
| `fix/` | Bug fixes |
| `feat/` | New features (discuss MCP tool changes first) |
| `docs/` | Documentation only |
| `test/` | Test coverage |
| `chore/` | CI, deps, release plumbing |

Examples: `fix/init-mkdir`, `test/lsp-client-mocks`, `docs/faq-seo`

## Development requirements

- Node.js 22+
- npm 10+
- All documentation and user-facing text in **English**
- MIT license applies to contributions

## Running tests

From the repository root:

```bash
npm install
npm run build
npm run typecheck
npm test
```

Package-level:

```bash
npm run test -w @rmpsoftware/locus-core
npm run test -w @rmpsoftware/locus-mcp
```

See [docs/contributing.md](docs/contributing.md) for mock vs integration test guidance.

## Pull request checklist

- [ ] `npm run build`, `npm run typecheck`, and `npm test` pass
- [ ] Tests added or updated for behavior changes
- [ ] Docs updated when user-facing behavior changes
- [ ] English only for user-facing strings and docs
- [ ] No secrets or credentials committed

## Commit messages

Use clear, imperative subject lines:

```
fix: create directory in locus init when missing
docs: add MCP tools reference with examples
test: cover .lsp.json config compatibility
ci: add publish workflow for npm and GitHub Packages
```

## Scope guidelines

- **In scope**: bug fixes, tests, docs, performance, adapter improvements
- **Discuss first**: new MCP tools, breaking config changes, major architecture shifts

## Questions

Open a GitHub issue for bugs, feature requests, or design questions.

Detailed developer docs: [docs/contributing.md](docs/contributing.md)

## Security

Report vulnerabilities privately — see [SECURITY.md](./SECURITY.md).

## Publishing (maintainers)

See [docs/publishing.md](docs/publishing.md) for release process and required secrets.
