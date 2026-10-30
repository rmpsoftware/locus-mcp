import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SymbolInformation } from "../lsp-client/types.js";
import { uriToFilePath } from "../lsp-client/connection.js";
import type { LspClient } from "../lsp-client/client.js";
import { relativePath } from "../lsp-client/client.js";
import { fanOut, mergeSymbols, type ServerFailure } from "../lsp-client/fan-out.js";

export interface ResolvedSymbol {
  name: string;
  qualifiedName: string;
  kind: number;
  filePath: string;
  relativePath: string;
  line: number;
  character: number;
  containerName?: string;
}

export interface SymbolResolveResult {
  status: "ok" | "no_results" | "ambiguous_symbol";
  symbols: ResolvedSymbol[];
  message?: string;
  failures: ServerFailure[];
}

export interface SymbolResolverOptions {
  rootPath: string;
  fuzzy?: boolean;
}

export class SymbolResolver {
  constructor(private readonly options: SymbolResolverOptions) {}

  async findByName(clients: LspClient[], query: string, filePath?: string, restrictToFile = false): Promise<SymbolResolveResult> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { status: "no_results", symbols: [], message: "Empty query", failures: [] };
    }

    const { symbols, failures } = await this.searchWorkspace(clients, trimmed, filePath, restrictToFile);
    const candidates = symbols.map((s) => toResolvedSymbol(s, this.options.rootPath));

    return { ...this.pickMatches(this.rankByQuery(candidates, trimmed), trimmed), failures };
  }

  private pickMatches(candidates: ResolvedSymbol[], trimmed: string): Omit<SymbolResolveResult, "failures"> {
    if (candidates.length === 0) {
      return { status: "no_results", symbols: [], message: `No symbols matching "${trimmed}"` };
    }

    const exact = candidates.filter(
      (c) => c.qualifiedName === trimmed || c.name === trimmed || c.qualifiedName.endsWith(`.${trimmed}`),
    );

    if (exact.length === 1) {
      return { status: "ok", symbols: exact };
    }

    if (exact.length > 1) {
      return {
        status: "ambiguous_symbol",
        symbols: exact.slice(0, 10),
        message: `Multiple symbols match "${trimmed}"`,
      };
    }

    if (candidates.length === 1) {
      return { status: "ok", symbols: [candidates[0]!] };
    }

    const topScore = scoreSymbol(candidates[0]!, trimmed);
    const closeMatches = candidates.filter((c) => scoreSymbol(c, trimmed) >= topScore - 2);

    if (closeMatches.length > 1) {
      return {
        status: "ambiguous_symbol",
        symbols: closeMatches.slice(0, 10),
        message: `Multiple symbols match "${trimmed}"`,
      };
    }

    return { status: "ok", symbols: [candidates[0]!] };
  }

  async findAtPosition(
    client: LspClient,
    filePath: string,
  ): Promise<ResolvedSymbol | undefined> {
    const symbols = await client.documentSymbol(filePath);
    if (symbols.length === 0) return undefined;

    const resolved = symbols.map((s) => toResolvedSymbol(s, this.options.rootPath));
    return resolved[0];
  }

  parseQualifiedName(name: string): { container?: string; member: string } {
    const parts = name.split(".");
    if (parts.length === 1) {
      return { member: parts[0]! };
    }
    return {
      container: parts.slice(0, -1).join("."),
      member: parts[parts.length - 1]!,
    };
  }

  private async searchWorkspace(
    clients: LspClient[],
    query: string,
    filePath?: string,
    restrictToFile = false,
  ): Promise<{ symbols: SymbolInformation[]; failures: ServerFailure[] }> {
    const inScope = (symbols: SymbolInformation[]) => restrictToFile && filePath
      ? symbols.filter((symbol) => resolve(uriToFilePath(symbol.location.uri)) === resolve(filePath))
      : symbols;
    const exact = await fanOut(clients, async (client) => {
      if (filePath) await client.didOpen(filePath);
      return client.workspaceSymbol(query);
    });
    const symbols = inScope(mergeSymbols(exact.results.map((r) => r.value)));
    if (symbols.length > 0) {
      return { symbols, failures: exact.failures };
    }

    const { member } = this.parseQualifiedName(query);
    const answering = exact.results.map((r) => r.client);
    const partial = member === query ? exact : await fanOut(answering, (client) => client.workspaceSymbol(member));
    const partialSymbols = inScope(mergeSymbols(partial.results.map((r) => r.value)));
    const failures = member === query ? exact.failures : [...exact.failures, ...partial.failures];
    if (partialSymbols.length > 0 || !filePath) {
      return { symbols: partialSymbols, failures };
    }

    const documents = await fanOut(partial.results.map((r) => r.client), (client) => client.documentSymbol(filePath));
    const lowerMember = member.toLowerCase();
    const documentSymbols = inScope(mergeSymbols(documents.results.map((r) => r.value))).filter((symbol) =>
      symbol.name.toLowerCase().includes(lowerMember) ||
      `${symbol.containerName ?? ""}.${symbol.name}`.toLowerCase().includes(lowerMember),
    );

    return {
      symbols: documentSymbols,
      failures: [...failures, ...documents.failures],
    };
  }

  private rankByQuery(symbols: ResolvedSymbol[], query: string): ResolvedSymbol[] {
    return [...symbols].sort((a, b) => scoreSymbol(b, query) - scoreSymbol(a, query));
  }
}

function toResolvedSymbol(symbol: SymbolInformation, rootPath: string): ResolvedSymbol {
  const filePath = uriToFilePath(symbol.location.uri);
  const qualifiedName = symbol.containerName ? `${symbol.containerName}.${symbol.name}` : symbol.name;

  return {
    name: symbol.name,
    qualifiedName,
    kind: symbol.kind,
    filePath,
    relativePath: relativePath(rootPath, symbol.location.uri),
    line: symbol.location.range.start.line,
    character: symbol.location.range.start.character,
    containerName: symbol.containerName,
  };
}

function scoreSymbol(symbol: ResolvedSymbol, query: string): number {
  let score = 0;
  const lowerQuery = query.toLowerCase();
  const lowerName = symbol.name.toLowerCase();
  const lowerQualified = symbol.qualifiedName.toLowerCase();

  if (symbol.qualifiedName === query) score += 100;
  if (symbol.name === query) score += 90;
  if (lowerQualified === lowerQuery) score += 80;
  if (lowerQualified.endsWith(`.${lowerQuery}`)) score += 70;
  if (lowerName === lowerQuery) score += 60;
  if (lowerQualified.includes(lowerQuery)) score += 20;
  if (lowerName.includes(lowerQuery)) score += 10;

  return score;
}

export function readLineSnippet(filePath: string, line: number, context = 0): string {
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const idx = Math.max(0, Math.min(line, lines.length - 1));
    return lines.slice(Math.max(0, idx - context), idx + context + 1).join("\n").trim();
  } catch {
    return "";
  }
}
