# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Tools send each request to every matching language server in parallel and return the combined results; a failing server no longer hides the others' answers
- `LspManager.getClientsForFile`, `getAllClients` and `getRunningClients`, plus `fanOut` and result-merging helpers in `@paladini/locus-core`
- `ignoreDirectories` server option, used by the file watcher and filename search
- `file` inputs accept paths relative to a server root and bare filenames, resolved by `LspManager.resolveFile`, with new `file_not_found` and `ambiguous_file` statuses

### Changed

- `locate` by name without a `file` queries all configured servers instead of the first ready one
- A server's `root` now scopes which files it receives when several servers handle an extension
- `SymbolResolver.findByName` takes an array of clients and reports per-server `failures`
- `status`, `locus check` and `locus warm` identify servers by `id`, and warm state is tracked per server
- Tools return `file_not_found` for a file that does not exist instead of querying servers about it

### Removed

- `LspManager.getClientForFile`, `configForFile` and `configForExtension`, replaced by the multi-server methods

### Fixed

- `rename` previews no longer come back empty for servers that return `documentChanges`
- Relative `file` paths resolve against the project root instead of the process working directory, which broke `locate`, `refs`, `hover` and `rename` under `locus serve --cwd`

## [0.1.5] - 2026-07-25

### Added

- GitHub Pages landing site at [paladini.io/locus-mcp](http://paladini.io/locus-mcp/)
- Expanded unit test coverage for MCP server wiring, context, handlers, and LspConnection integration

### Fixed

- GitHub Pages deploy workflow (`enablement: true` for first-time setup)

## [0.1.4] - 2026-07-24

### Added

- Package READMEs for `@paladini/locus-mcp` and `@paladini/locus-core` with setup, usage, and troubleshooting

## [0.1.3] - 2026-07-24

### Fixed

- Publish workflow: reliable GitHub Packages auth and dual-registry publish
- Publish workflow: skip npm republish when version already exists; optional `NPM_TOKEN` bootstrap for first release

## [0.1.2] - 2026-07-24

### Added

- First public npm release under `@paladini/locus-core` and `@paladini/locus-mcp`
- Official MCP Registry metadata (`server.json`, `mcpName`)
- Glama directory metadata (`glama.json`)
- MCPB bundle for Claude Desktop and Smithery (`npm run pack:mcpb`)
- Unified publish workflow: npm, GitHub Packages, MCP Registry, GitHub Release
- Directory submissions checklist (`docs/directory-submissions.md`)

### Changed

- Renamed npm scope from `@locus-dev` to `@paladini`
- Updated all docs and install commands to `npx @paladini/locus-mcp`
