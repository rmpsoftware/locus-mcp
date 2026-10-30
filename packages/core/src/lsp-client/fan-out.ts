import type { LspClient } from "./client.js";
import type { Diagnostic, Location, Range, SymbolInformation, TextEdit, WorkspaceEdit } from "./types.js";

export interface ServerResult<T> {
  client: LspClient;
  value: T;
}

export interface ServerFailure {
  client: LspClient;
  error: unknown;
}

export interface FanOutResult<T> {
  results: ServerResult<T>[];
  failures: ServerFailure[];
}

export async function fanOut<T>(
  clients: LspClient[],
  request: (client: LspClient) => Promise<T>,
): Promise<FanOutResult<T>> {
  const settled = await Promise.allSettled(clients.map(async (client) => request(client)));
  const outcome: FanOutResult<T> = { results: [], failures: [] };

  settled.forEach((result, index) => {
    const client = clients[index]!;
    if (result.status === "fulfilled") {
      outcome.results.push({ client, value: result.value });
    } else {
      outcome.failures.push({ client, error: result.reason });
    }
  });

  return outcome;
}

export function mergeLocations(lists: Location[][]): Location[] {
  return uniqueBy(lists.flat(), (l) => `${l.uri}#${rangeKey(l.range)}`);
}

export function mergeSymbols(lists: SymbolInformation[][]): SymbolInformation[] {
  return uniqueBy(lists.flat(), (s) => {
    const { line, character } = s.location.range.start;
    return `${s.name}@${s.location.uri}#${line}:${character}`;
  });
}

export function mergeDiagnostics(lists: Diagnostic[][]): Diagnostic[] {
  return uniqueBy(lists.flat(), (d) => `${rangeKey(d.range)}|${d.severity}|${d.message}`);
}

export function mergeWorkspaceEdits(edits: WorkspaceEdit[]): Record<string, TextEdit[]> {
  const merged = new Map<string, TextEdit[]>();
  const add = (uri: string, textEdits: TextEdit[]) => merged.set(uri, [...(merged.get(uri) ?? []), ...textEdits]);

  for (const edit of edits) {
    for (const [uri, textEdits] of Object.entries(edit.changes ?? {})) add(uri, textEdits);
    for (const change of edit.documentChanges ?? []) add(change.textDocument.uri, change.edits);
  }

  return Object.fromEntries(
    [...merged].map(([uri, textEdits]) => [uri, uniqueBy(textEdits, (e) => `${rangeKey(e.range)}|${e.newText}`)]),
  );
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const unique = new Map<string, T>();
  for (const item of items) {
    const itemKey = key(item);
    if (!unique.has(itemKey)) unique.set(itemKey, item);
  }
  return [...unique.values()];
}

function rangeKey({ start, end }: Range): string {
  return `${start.line}:${start.character}-${end.line}:${end.character}`;
}
