# Publishing Guide

This document describes how maintainers release `@rmpsoftware/locus-core` and `@rmpsoftware/locus-mcp` to npm, the official MCP Registry, GitHub Packages, and distribution channels.

## Prerequisites

- npm account with publish access to the `@rmpsoftware` scope on npmjs.org
- GitHub repository `rmpsoftware/locus-mcp` (for the `io.github.rmpsoftware/locus-mcp` namespace)
- **npm Trusted Publishing** configured for this GitHub repo (recommended — no `NPM_TOKEN` needed)

## npm Trusted Publishing (recommended)

npm recommends **Trusted Publishing** over long-lived access tokens for CI/CD. The workflow [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) is configured for OIDC — you do **not** need an `NPM_TOKEN` secret when Trusted Publishing is set up.

### One-time setup on npmjs.com

Configure Trusted Publisher for **each** package (`@rmpsoftware/locus-core` and `@rmpsoftware/locus-mcp`):

1. Log in at [npmjs.com](https://www.npmjs.com/) and open the package page.
2. Go to **Settings** → **Publishing access** → **Trusted Publisher**.
3. Click **GitHub Actions** and fill in **exactly**:

   | Field | Value |
   |-------|-------|
   | **Organization or user** | `rmpsoftware` |
   | **Repository** | `locus-mcp` |
   | **Workflow filename** | `publish.yml` |
   | **Environment** | *(leave empty)* |

4. Save. Fields are **case-sensitive** — the workflow file must be `.github/workflows/publish.yml`.

### How it works

When you push a `v*` tag, GitHub Actions issues a short-lived OIDC token. npm verifies that the workflow matches your Trusted Publisher config and allows `npm publish` without any stored secret.

### First publish (if packages do not exist yet)

Trusted Publishing works for **updates** to an existing package. If `@rmpsoftware/locus-core` or `@rmpsoftware/locus-mcp` are not on npm yet, publish once manually from your machine:

```bash
npm login
npm run build
npm test
npm publish -w @rmpsoftware/locus-core --access public
npm publish -w @rmpsoftware/locus-mcp --access public
```

Then configure Trusted Publisher as above for all future releases via CI.

### Requirements

- GitHub-hosted runner (`ubuntu-latest`)
- `permissions: id-token: write` in the workflow (already set)
- npm CLI ≥ 11.5.1 (workflow runs `npm install -g npm@latest`)
- Node.js 22 in CI (already set)

## Version bump checklist

Update version in **all** of these locations:

1. `packages/core/package.json` → `"version"`
2. `packages/mcp/package.json` → `"version"` and the exact `@rmpsoftware/locus-core` dependency version
3. Root `package.json` → `"version"` (informational; root is private)
4. [`server.json`](../server.json) → `"version"` and `packages[0].version`
5. [`mcpb/manifest.json`](../mcpb/manifest.json) → `"version"`
6. `packages/mcp/src/server.ts` → server version string in `createLocusServer`
7. `package-lock.json` → run `npm install --ignore-scripts` after updating versions
8. [`CHANGELOG.md`](../CHANGELOG.md) → new dated section

Keep `@rmpsoftware/locus-core` and `@rmpsoftware/locus-mcp` versions in sync for each release.

## Release process (automated)

Publishing is automated via [`.github/workflows/publish.yml`](../.github/workflows/publish.yml).

1. Merge all changes to `main`
2. Run verification locally:

   ```bash
   npm run build
   npm run typecheck
   npm test
   ```

3. Create and push a version tag:

   ```bash
   git tag v0.1.5
   git push origin main
   git push origin v0.1.5
   ```

4. GitHub Actions will:
   - Build and test the monorepo
   - Pack the Claude Desktop `.mcpb` bundle
   - Publish `@rmpsoftware/locus-core` then `@rmpsoftware/locus-mcp` to **npmjs.org** (`--access public --provenance`)
   - Publish both packages to **GitHub Packages**
   - Publish to the [official MCP Registry](https://registry.modelcontextprotocol.io) via `mcp-publisher`
   - Create a GitHub Release with `locus-mcp.mcpb` attached

**Publish order:** `@rmpsoftware/locus-core` must publish before `@rmpsoftware/locus-mcp` (workspace dependency).

## Manual publishing (fallback)

Build first:

```bash
npm run build
npm test
```

### npmjs.org

```bash
npm publish -w @rmpsoftware/locus-core --access public
npm publish -w @rmpsoftware/locus-mcp --access public
```

### Official MCP Registry

```bash
# Install mcp-publisher (macOS/Linux)
curl -sL "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_linux_amd64.tar.gz" | tar xz mcp-publisher

# Authenticate with GitHub
mcp-publisher login github

# Validate without publishing
mcp-publisher validate ./server.json
mcp-publisher publish --dry-run

# Publish
mcp-publisher publish
```

The `server.json` `name` field (`io.github.rmpsoftware/locus-mcp`) must match `mcpName` in `packages/mcp/package.json`.

### Claude Desktop Extension (.mcpb)

```bash
npm run build
npm run pack:mcpb
```

This creates `locus-mcp.mcpb` in the project root. Attach it to a GitHub Release or distribute directly.

### GitHub Packages

Create or update `~/.npmrc`:

```ini
@rmpsoftware:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT
```

Then:

```bash
npm publish -w @rmpsoftware/locus-core --registry https://npm.pkg.github.com
npm publish -w @rmpsoftware/locus-mcp --registry https://npm.pkg.github.com
```

See [`.npmrc.example`](../.npmrc.example) for consumer configuration.

## Installing from GitHub Packages

Consumers need a GitHub PAT with `read:packages` scope:

```bash
npm install @rmpsoftware/locus-mcp --registry https://npm.pkg.github.com
```

Or configure `.npmrc` in the project (see `.npmrc.example`).

## Distribution channels

| Channel | Status | Notes |
|---------|--------|-------|
| [npm](https://www.npmjs.com/package/@rmpsoftware/locus-mcp) | Pending first publish | Primary distribution |
| [MCP Registry](https://registry.modelcontextprotocol.io) | Automated on tag push | `server.json` + `mcp-publisher` |
| [GitHub Packages](https://github.com/rmpsoftware/locus-mcp/pkgs/npm/locus-mcp) | Automated on tag push | `@rmpsoftware` scope |
| [Claude Desktop .mcpb](https://github.com/rmpsoftware/locus-mcp/releases) | GitHub Releases | Bundled extension |
| Third-party directories | See [directory-submissions.md](./directory-submissions.md) | Glama, Smithery, mcp.so, PulseMCP |

## Dry-run (local)

```bash
npm run build
npm pack -w @rmpsoftware/locus-core
npm pack -w @rmpsoftware/locus-mcp
```

Inspect the generated `.tgz` files before publishing.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Registry rejects `name` mismatch | Ensure `packages/mcp/package.json` `mcpName` equals `server.json` `name` |
| Registry auth fails in CI | Verify `id-token: write` permission and `github-oidc` login |
| npm publish 403 | Configure Trusted Publisher on npmjs.com; or publish manually once, then enable Trusted Publisher |
| GitHub Packages 409 | Version already published — bump version |
| `@rmpsoftware/locus-mcp` fails install | Publish `@rmpsoftware/locus-core` first, or keep versions aligned |
| MCPB pack fails | Run `npm run build` first; ensure Node.js 22+ |
| Workflow not triggered | Tag must match `v*` pattern; check Actions permissions |
