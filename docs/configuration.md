# Configuration

Locus discovers configuration by walking up from the current working directory. The first match wins within each directory; file priority is `locus.json` → `.lsp.json`.

Locus no longer reads `locus.toml`. If you used one, move its `root` and
`warm` settings into `locus.json`, preserving any server definitions already
there. The JSON file is now used even when a legacy TOML file exists beside it.

## locus.json

Full server configuration example:

```json
{
  "root": ".",
  "warm": ["typescript", "python"],
  "servers": [
    {
      "id": "typescript",
      "root": "frontend",
      "ignoreDirectories": ["node_modules", "dist"],
      "languageId": "typescript",
      "extensions": [".ts", ".tsx", ".js", ".jsx"],
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "autoOpenFiles": ["src/main.ts"],
      "initSleep": 2000
    },
    {
      "id": "python",
      "ignoreDirectories": ["__pycache__"],
      "languageId": "python",
      "extensions": [".py", ".pyi"],
      "command": "pyright-langserver",
      "args": ["--stdio"]
    }
  ]
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `root` | string | Project root path (default: directory containing config) |
| `warm` | string[] | Language IDs to pre-start via `locus warm` |
| `servers` | array | Language server definitions |

### Server entry fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique identifier |
| `languageId` | yes | LSP language ID sent on document open |
| `extensions` | yes | File extensions this server handles |
| `command` | yes | Executable name or path |
| `ignoreDirectories` | no | Directory names skipped at any depth by this server's file watcher and filename search, for example `["bin", "obj"]`. Replaces the built-in list when you define your own servers |
| `root` | no | Server workspace root and process working directory, relative to the project root; defaults to the project root |
| `args` | no | CLI arguments (use `["--stdio"]` for stdio servers); relative paths are resolved by the launched program from the server root |
| `autoOpenFiles` | no | Files to open after initialization, relative to the server root (absolute paths are also supported) |
| `initSleep` | no | Delay in milliseconds after initialization and opening files; positive integers wait, zero or negative values disable the delay |

When `servers` is omitted or empty, Locus uses built-in defaults.

`autoOpenFiles` can initialize a language server's project before a workspace symbol search. For TypeScript, list a source file belonging to the project, such as `src/main.ts`, rather than `tsconfig.json`. Files are opened again when the server restarts; a missing or unreadable file causes startup to fail with an error.

`initSleep` delays requests until the configured time has elapsed, including after a server restart. It gives the server time to initialize but does not guarantee indexing has finished. The maximum supported value is 2147483647 ms.

### File watching

Each running server recursively watches its own root. Only files with extensions handled by the server are synchronized; files in hidden directories or in the server's `ignoreDirectories` are skipped. Created or modified matching files are read after a short debounce and sent as full-text `textDocument/didChange` notifications, with increasing versions. Documents are opened first if necessary. Unchanged content is skipped; deleted or unreadable files are ignored. Watchers start when the server starts and close when it stops.

`ignoreDirectories` matches exact directory names. List build output for your language so generated files are not sent to the server or matched by filename. The built-in servers ignore `node_modules`, `dist` and `build` (TypeScript), `__pycache__` (Python) and `target` (Rust).

The top-level `root` is relative to the directory containing the configuration file. Each server's `root` is relative to that project root; absolute paths are also supported.

### Multiple servers for one file

Several servers can handle the same extension, for example a compiler and a linter, or one server per solution in a monorepo. Give each a unique `id`:

```json
{
  "servers": [
    { "id": "api", "root": "services/api", "languageId": "csharp", "extensions": [".cs"], "command": "csharp-ls" },
    { "id": "web", "root": "services/web", "languageId": "csharp", "extensions": [".cs"], "command": "csharp-ls" },
    { "id": "lint", "languageId": "csharp", "extensions": [".cs"], "command": "my-cs-linter", "args": ["--stdio"] }
  ]
}
```

Every tool sends its request to all selected servers in parallel and combines the answers:

- A server is selected when it handles the file's extension and its `root` contains the file. A server without `root` uses the project root, so it receives every project file (`lint` above).
- If no server's root contains the file, no server is selected. Configure a server whose root includes the file to query a shared library outside the project.
- `locate` by name without a `file` goes to every configured server, starting any that are not running.

Use `list_projects` to discover server IDs, roots and languages. The `project` and `lang` parameters on navigation and diagnostics tools restrict selection to matching configurations; see [project and language filters](./tools.md#project-and-language-filters).

A request waits for the slowest selected server to start, including any `initSleep`, then for its response (up to the 30-second LSP request timeout). See [how results are combined](./tools.md#multiple-language-servers).

## .lsp.json compatibility

Locus reads `.lsp.json` for compatibility with Claude Code Open Plugins and similar manifests.

### Legacy `languageServer` block

```json
{
  "languageServer": {
    "command": "typescript-language-server",
    "args": ["--stdio"],
    "extensionToLanguage": {
      "ts": "typescript",
      "tsx": "typescriptreact"
    }
  }
}
```

Locus converts this into an additional server entry merged with defaults.

### `servers` array

```json
{
  "servers": [
    {
      "id": "ruby",
      "languageId": "ruby",
      "extensions": [".rb"],
      "command": "solargraph",
      "args": ["stdio"]
    }
  ]
}
```

Custom servers from `.lsp.json` are appended to the configured server list.

## Built-in language servers

| Language | Command | Extensions |
|----------|---------|------------|
| TypeScript/JS | `typescript-language-server` | `.ts`, `.tsx`, `.js`, `.jsx`, … |
| Python | `pyright-langserver` | `.py`, `.pyi` |
| Go | `gopls` | `.go` |
| Rust | `rust-analyzer` | `.rs` |

Run `locus check` to verify each binary is on your `PATH`.

### Windows notes

If you install Pyright via pip, ensure the Python Scripts directory is on `PATH` (e.g. `%LOCALAPPDATA%\Python\pythoncore-3.14-64\Scripts`).

## CLI environment

All commands accept `--cwd <path>` to set the process working directory and
project root. Relative paths are resolved from the original working directory.
The directory must exist, except for `init`, which creates it if needed:

```bash
locus serve --cwd /path/to/project
locus init --cwd /path/to/project
locus check --cwd /path/to/project
locus warm --cwd /path/to/project
```

The MCP server uses the host-provided working directory when launched via MCP config `cwd`.

## Output status codes

Tool responses include a discriminated status:

| Status | Meaning |
|--------|---------|
| `ok` | Success |
| `no_results` | Valid query, nothing found |
| `server_starting` | LSP still indexing — retry or call `warm` |
| `server_unavailable` | Binary missing or server crashed |
| `ambiguous_symbol` | Multiple matches — narrow the query |
| `error` | Invalid input or unexpected failure |
