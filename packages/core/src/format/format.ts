import type { Diagnostic, Hover, Location } from "../lsp-client/types.js";
import { DiagnosticSeverity } from "../lsp-client/types.js";
import { uriToFilePath } from "../lsp-client/connection.js";
import type { ResolvedSymbol } from "../symbol-layer/resolver.js";
import { readLineSnippet } from "../symbol-layer/resolver.js";

export type LocusStatus =
  | "ok"
  | "no_results"
  | "server_starting"
  | "server_unavailable"
  | "ambiguous_symbol"
  | "file_not_found"
  | "ambiguous_file"
  | "error";

export interface LocusResult<T = string> {
  status: LocusStatus;
  data?: T;
  message?: string;
}

export function formatSymbolLocation(symbol: ResolvedSymbol, rootPath?: string): string {
  const snippet = readLineSnippet(symbol.filePath, symbol.line);
  const path = rootPath ? symbol.relativePath : symbol.filePath;
  const col = symbol.character + 1;
  const line = symbol.line + 1;
  return `${path}:${line}:${col}: ${symbol.qualifiedName}${snippet ? ` | ${truncate(snippet, 80)}` : ""}`;
}

export function formatLocationRef(location: Location, rootPath: string): string {
  const filePath = uriToFilePath(location.uri);
  const rel = toRelative(rootPath, filePath);
  const line = location.range.start.line + 1;
  const col = location.range.start.character + 1;
  const snippet = readLineSnippet(filePath, location.range.start.line);
  return `${rel}:${line}:${col}:${snippet ? ` ${truncate(snippet, 80)}` : ""}`;
}

export function formatLocations(refs: Location[], rootPath: string): string[] {
  return refs.map((r) => formatLocationRef(r, rootPath));
}

export function formatHover(hover: Hover | null): string {
  if (!hover) return "No hover information available.";

  const contents = hover.contents;
  if (typeof contents === "string") {
    return contents;
  }

  if (Array.isArray(contents)) {
    return contents
      .map((c) => (typeof c === "string" ? c : c.value))
      .join("\n\n");
  }

  return contents.value;
}

export function formatHovers(hovers: Array<{ server: string; hover: Hover | null }>): string {
  const answers = new Map<string, string>();

  for (const { server, hover } of hovers) {
    const text = hover ? formatHover(hover).trim() : "";
    if (text && !answers.has(text)) answers.set(text, server);
  }

  if (answers.size === 0) return formatHover(null);
  if (answers.size === 1) return [...answers.keys()][0]!;

  return [...answers].map(([text, server]) => `## ${server}\n\n${text}`).join("\n\n");
}

export function formatDiagnostics(diagnostics: Diagnostic[], filePath: string, rootPath: string): string {
  if (diagnostics.length === 0) {
    return `No diagnostics for ${toRelative(rootPath, filePath)}`;
  }

  const rel = toRelative(rootPath, filePath);
  const grouped = new Map<string, Diagnostic[]>();

  for (const diag of diagnostics) {
    const severity = severityLabel(diag.severity);
    const group = grouped.get(severity) ?? [];
    group.push(diag);
    grouped.set(severity, group);
  }

  const lines: string[] = [`# ${rel}`];

  for (const [severity, diags] of grouped) {
    lines.push(`## ${severity}`);
    for (const diag of diags) {
      const line = diag.range.start.line + 1;
      const col = diag.range.start.character + 1;
      lines.push(`${line}:${col}: ${diag.message}`);
    }
  }

  return lines.join("\n");
}

export function formatWorkspaceDiagnostics(
  byFile: Map<string, Diagnostic[]>,
  rootPath: string,
): string {
  if (byFile.size === 0) {
    return "No workspace diagnostics.";
  }

  const sections: string[] = [];
  for (const [uri, diags] of byFile) {
    const filePath = uri.startsWith("file:") ? uriToFilePath(uri) : uri;
    sections.push(formatDiagnostics(diags, filePath, rootPath));
  }
  return sections.join("\n\n");
}

export function formatStatus(
  statuses: Array<{
    id: string;
    command: string;
    state: string;
    binaryAvailable: boolean;
    warmed: boolean;
    openDocuments: number;
    progress?: { observed: boolean; active: string[] };
  }>,
): string {
  const lines = ["# Locus LSP Status", ""];

  for (const s of statuses) {
    const binary = s.binaryAvailable ? "installed" : "MISSING";
    lines.push(
      `- **${s.id}** (${s.command}): ${s.state}, binary ${binary}, warmed=${s.warmed}, docs=${s.openDocuments}`,
    );
    if (s.progress?.active.length) {
      lines.push(`  Background work: ${s.progress.active.join("; ")}`);
    }
  }

  return lines.join("\n");
}

export function errorResult(status: LocusStatus, message: string): LocusResult {
  return { status, message };
}

export function okResult<T>(data: T, message?: string): LocusResult<T> {
  return { status: "ok", data, message };
}

function severityLabel(severity?: number): string {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return "error";
    case DiagnosticSeverity.Warning:
      return "warning";
    case DiagnosticSeverity.Information:
      return "info";
    case DiagnosticSeverity.Hint:
      return "hint";
    default:
      return "unknown";
  }
}

function toRelative(rootPath: string, filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(rootPath.replace(/\\/g, "/"), "").replace(/^\//, "");
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 3)}...`;
}

export function formatRenamePreview(
  changes: Record<string, import("../lsp-client/types.js").TextEdit[]>,
  rootPath: string,
): string {
  const lines: string[] = ["# Rename preview", ""];

  for (const [uri, edits] of Object.entries(changes)) {
    const filePath = uriToFilePath(uri);
    const rel = toRelative(rootPath, filePath);
    lines.push(`## ${rel} (${edits.length} edit${edits.length === 1 ? "" : "s"})`);
    for (const edit of edits.slice(0, 20)) {
      const line = edit.range.start.line + 1;
      lines.push(`- L${line}: ${truncate(edit.newText, 60)}`);
    }
    if (edits.length > 20) {
      lines.push(`- ... and ${edits.length - 20} more edits`);
    }
  }

  return lines.join("\n");
}
