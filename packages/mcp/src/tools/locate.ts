import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  fanOut,
  formatSymbolLocation,
  mergeSymbols,
  okResult,
  errorResult,
} from "@rmpsoftware/locus-core";
import type { LocusServerContext } from "../context.js";
import { allFailedResult, FILE_PATH_HINT, SERVER_FILTER_PROPERTIES, serverFilterError, serverFilterSchema, withFailures } from "./helpers.js";

export const locateTool = {
  name: "locate",
  description:
    "Find a symbol by name (supports qualified names like Foo.bar) or get document symbol overview. Primary navigation tool — prefer over Grep for semantic lookup.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ...SERVER_FILTER_PROPERTIES,
      name: {
        type: "string",
        description: "Symbol name or qualified name (e.g. MyClass.method)",
      },
      file: {
        type: "string",
        description: `Optional file to open and select language servers for name lookup, or to list document symbols. ${FILE_PATH_HINT}`,
      },
    },
  },
};

const locateSchema = z.object({
  ...serverFilterSchema,
  name: z.string().optional(),
  file: z.string().optional(),
});

export async function handleLocate(ctx: LocusServerContext, args: unknown): Promise<CallToolResult> {
  const input = locateSchema.parse(args ?? {});
  const filterError = serverFilterError(ctx, input);
  if (filterError) return textResult(filterError);

  let file = input.file;
  if (file) {
    const resolved = await ctx.manager.resolveFile(file, input);
    if (resolved.status !== "ok") {
      return textResult(resolved);
    }
    file = resolved.file;
  }

  if (file && !input.name) {
    const clients = await ctx.manager.getClientsForFile(file, input);
    if (clients.length === 0) {
      return textResult(errorResult("no_results", `No LSP configured for ${file}`));
    }

    const { results, failures } = await fanOut(clients, (client) => client.documentSymbol(file));
    if (results.length === 0) {
      return textResult(allFailedResult(failures));
    }

    const symbols = mergeSymbols(results.map((r) => r.value));
    if (symbols.length === 0) {
      return textResult(withFailures(errorResult("no_results", "No symbols in document"), failures));
    }

    const lines = symbols.slice(0, 50).map((s) => {
      const filePath = s.location.uri.replace(/^file:\/\//, "");
      return `${filePath}:${s.location.range.start.line + 1}:${s.location.range.start.character + 1}: ${s.containerName ? `${s.containerName}.` : ""}${s.name}`;
    });

    return textResult(withFailures(okResult(lines.join("\n"), `${symbols.length} symbol(s)`), failures));
  }

  if (!input.name) {
    return textResult(errorResult("error", "Provide 'name' or 'file'"));
  }

  const clients = file ? await ctx.manager.getClientsForFile(file, input) : await ctx.manager.getAllClients(input);
  if (clients.length === 0) {
    return textResult(errorResult("server_unavailable", "No language server available for query"));
  }

  const result = await ctx.resolver.findByName(clients, input.name, file);
  if (result.failures.length === clients.length) {
    return textResult(allFailedResult(result.failures));
  }

  if (result.status === "no_results") {
    return textResult(withFailures(errorResult("no_results", result.message ?? "No symbols found"), result.failures));
  }

  const lines = result.symbols.map((s) => formatSymbolLocation(s, ctx.rootPath));

  if (result.status === "ambiguous_symbol") {
    return textResult(
      withFailures(
        {
          status: "ambiguous_symbol",
          message: result.message,
          data: lines.join("\n"),
        },
        result.failures,
      ),
    );
  }

  return textResult(withFailures(okResult(lines.join("\n")), result.failures));
}

function textResult(result: { status: string; data?: string; message?: string }): CallToolResult {
  const parts = [`status: ${result.status}`];
  if (result.message) parts.push(result.message);
  if (result.data) parts.push("", result.data);

  return {
    content: [{ type: "text", text: parts.join("\n") }],
    isError: result.status !== "ok" && result.status !== "ambiguous_symbol",
  };
}
