# MCP Tools Reference

Locus exposes seven MCP tools. Prefer these over text search when you need definitions, references, types, or compiler diagnostics.

## Tool overview

| Tool | Purpose |
|------|---------|
| `locate` | Find symbol by name or document overview |
| `refs` | References or implementations |
| `hover` | Type info and documentation |
| `diagnostics` | File or workspace diagnostics |
| `status` | Server readiness and missing binaries |
| `rename` | Preview rename (dry-run by default) |
| `list_projects` | List configured project IDs, roots, and languages |

Query tools return text with a leading `status:` line. Non-`ok` statuses set MCP `isError` where appropriate. `list_projects` returns a JSON array.

## Project and language filters

`locate`, `refs`, `hover`, `diagnostics`, and `rename` accept optional `project` and `lang` strings. `project` matches a server configuration's `id` exactly; `lang` matches its `languageId` exactly. If both are supplied, both must match. These filters select configurations before file resolution and server startup; they do not restrict workspace symbols returned by a selected server. File-based requests still require the selected server to handle the extension and contain the file in its root. With no filters, existing selection behavior is unchanged.

An unknown or incompatible filter combination returns `server_unavailable`. For workspace diagnostics, filters apply to already-running servers and do not start others. Use `list_projects` to discover available values.

```json
{ "name": "Greeter", "project": "api", "lang": "csharp" }
```

## list_projects

Call `list_projects` with `{}` to list every configured server without starting it. Its MCP text content is a JSON array, with one entry per configuration:

```json
[
  { "project": "api", "root": "/repo/services/api", "language": "csharp" }
]
```

`root` is the absolute resolved server root, including the project root when no server root is configured. `language` is the value accepted by the `lang` filter. Multiple configurations can have the same ID; the filter selects all matches.

---

## locate

Find a symbol by name (including qualified names like `MyClass.method`) or list symbols in a file.

**Input**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | one of name/file | Symbol or qualified name |
| `file` | string | one of name/file | File path for document symbol overview or to select servers for a name lookup |

When both `name` and `file` are supplied, Locus opens the file before searching the selected servers' workspace symbols. If the workspace search finds nothing, it searches that file's document symbols instead. Workspace matches may still refer to other files.

An empty result retains `no_results` and notes that indexing state is unknown.
If a selected server reports LSP work-done progress, active background work is
also shown. Progress may describe work other than indexing; its absence or
completion does not guarantee a complete index. `status` also shows active work.
Servers that fail are reported separately. Retry if results might be incomplete.

**Examples**

Find a class:

```json
{ "name": "Greeter" }
```

Find a method:

```json
{ "name": "Greeter.greet" }
```

List symbols in a file:

```json
{ "file": "src/index.ts" }
```

**Sample output**

```
status: ok

src/index.ts:5:3: Greeter.greet | greet(name: string): string {
```

**Ambiguous result**

Multiple symbol matches retain the `ambiguous_symbol` status but do not set MCP
`isError`; the returned locations can be used to disambiguate the query.

```
status: ambiguous_symbol
Multiple symbols match "process"

src/a.ts:10:4: ModuleA.process
src/b.ts:3:1: ModuleB.process
```

---

## refs

Find references or implementations at a position.

**Input**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | yes* | File containing the symbol |
| `line` | number | yes* | 0-based line |
| `character` | number | yes* | 0-based character |
| `position` | string | alt | Shorthand `path:line:col` (1-based) |
| `implementations` | boolean | no | Find implementations instead of references |
| `include_declaration` | boolean | no | Include declaration (default true) |
| `limit` | number | no | Max results (default 50) |

\*Required unless `position` is provided.

**Example**

```json
{
  "file": "src/index.ts",
  "line": 4,
  "character": 10
}
```

Or with shorthand:

```json
{
  "file": "src/index.ts",
  "position": "src/index.ts:5:11"
}
```

**Sample output**

```
status: ok
3 result(s)

src/index.ts:12:4: const g = new Greeter()
src/app.ts:8:2: greeter.greet('world')
```

---

## hover

Get type information and documentation for a symbol or position.

**Input**

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Resolve symbol by name (requires `file`) |
| `file` | string | File path |
| `line` | number | 0-based line |
| `character` | number | 0-based character |
| `position` | string | Shorthand `path:line:col` |

**Example — by position**

```json
{
  "file": "src/index.ts",
  "line": 4,
  "character": 10
}
```

**Example — by name**

```json
{
  "name": "Greeter",
  "file": "src/index.ts"
}
```

**Sample output**

```
status: ok

```typescript
class Greeter {
  greet(name: string): string
}
```
```

---

## diagnostics

Get compiler or linter diagnostics for a file or open workspace documents.

For a file, Locus requests pull diagnostics when supported; otherwise it waits for
the server to publish diagnostics. A server that does not respond within three
seconds is reported as timed out, not as having no diagnostics. Servers can
publish further updates later, and unversioned push notifications cannot always
be matched to a particular edit. Workspace diagnostics are cached results for
open documents and may be incomplete or stale.

**Input**

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | string | Specific file (relative to project root) |
| `workspace` | boolean | Collect from all open documents |

**Example — single file**

```json
{ "file": "src/index.ts" }
```

**Example — workspace**

```json
{ "workspace": true }
```

**Sample output**

```
status: ok
2 diagnostic(s)

# src/index.ts
## error
12:4: Type 'string' is not assignable to type 'number'.
## warning
3:1: 'unused' is declared but never used.
```

---

## status

Check language server readiness, warm state, and missing binaries. Call this when other tools return `server_starting` or `server_unavailable`.

**Input**

No parameters.

**Example**

```json
{}
```

**Sample output**

```
status: ok

# Locus LSP Status

- **typescript** (typescript-language-server): ready, binary installed, warmed=true, docs=1
- **python** (pyright-langserver): stopped, binary installed, warmed=false, docs=0
- **go** (gopls): stopped, binary MISSING, warmed=false, docs=0
```

---

## rename

Preview or plan a symbol rename. Defaults to dry-run; set `apply=true` to get the full edit plan (host agent applies edits).

**Input**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `new_name` | string | yes | Target symbol name |
| `file` | string | yes* | File containing symbol |
| `line` | number | yes* | 0-based line |
| `character` | number | yes* | 0-based character |
| `position` | string | alt | Shorthand `path:line:col` |
| `apply` | boolean | no | Return apply plan (default false) |

**Example**

```json
{
  "file": "src/index.ts",
  "line": 4,
  "character": 6,
  "new_name": "Welcomer"
}
```

**Sample output**

```
status: ok
Dry run — set apply=true to execute

# Rename preview

## src/index.ts (3 edits)
- L5: Welcomer
- L12: Welcomer
- L20: Welcomer
```

---

## File paths

Every `file` input, including the path in a `position` shorthand, is resolved the same way:

1. An **absolute path** is used as is.
2. A **relative path** is tried against the project root, then against the `root` of each server that handles its extension. With filters, a project-root match must also be inside a selected server root.
3. A **bare filename** (no directory) that step 2 did not find is searched for under those server roots, so `{ "file": "TestResultHelper.cs" }` works if only one file has that name. Hidden directories and each server's [`ignoreDirectories`](./configuration.md#server-entry-fields) are skipped.

Filenames match exactly, including case. A path with a directory is never searched for, so use a bare filename or the full path.
When `project` or `lang` is supplied, only matching server roots are searched.

If nothing matches, the status is `file_not_found`. If several files match, nothing runs and the status is `ambiguous_file`, listing absolute paths to retry with:

```
status: ambiguous_file
Multiple files match "TestResultHelper.cs"

/repo/backend/src/Helpers/TestResultHelper.cs
/repo/backend/src/TestResults/TestResultHelper.cs
```

---

## Multiple language servers

When several servers handle a file, each tool asks all of them in parallel (see [configuration](./configuration.md#multiple-servers-for-one-file)) and returns one combined answer:

| Tool | Combined result |
|------|-----------------|
| `locate` | Symbols from all servers, ranked together. A symbol reported by several servers counts once, so it is not `ambiguous_symbol`. |
| `refs` | Locations from all servers without duplicates. `limit` applies to the combined list. |
| `hover` | One answer when the servers agree or only one replies. Otherwise a `## <server id>` section per server. |
| `diagnostics` | Diagnostics from all servers without duplicates. |
| `rename` | Edits from all servers without duplicates. Servers that cannot rename the symbol are skipped. |

If some servers fail, you still get the others' results and the status reflects them, followed by one line per failed server:

```
status: ok
3 result(s)
lint failed (server_unavailable): Language server is unavailable. Run `locus check` to verify binaries.

src/index.ts:12:4: const g = new Greeter()
```

A failure status is returned only when every server failed. If several failed and any is still starting, the status is `server_starting`, so retrying is worthwhile.

---

## Agent guidance

- Use **Locus** for definitions, references, types, and diagnostics.
- Use **Grep** for free text, comments, strings, and regex patterns.
- Call `status` after edits if diagnostics seem stale.
- On `ambiguous_symbol`, pick the qualified name from the list and retry `locate`.
- On `ambiguous_file`, pick the absolute path from the list and retry.
