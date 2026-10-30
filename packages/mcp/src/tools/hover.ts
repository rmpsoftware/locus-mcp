import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fanOut, formatHovers, okResult, errorResult } from "@rmpsoftware/locus-core";
import type { LocusServerContext } from "../context.js";
import { allFailedResult, FILE_PATH_HINT, parsePosition, SERVER_FILTER_PROPERTIES, serverFilterError, serverFilterSchema, withFailures } from "./helpers.js";

export const hoverTool = {
  name: "hover",
  description: "Get type information and documentation for a symbol or position.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ...SERVER_FILTER_PROPERTIES,
      name: { type: "string", description: "Symbol name to resolve" },
      file: { type: "string", description: FILE_PATH_HINT },
      line: { type: "number", description: "0-based line" },
      character: { type: "number", description: "0-based character" },
      position: { type: "string", description: "Alternative: path:line:col (1-based)" },
    },
  },
};

const hoverSchema = z.object({
  ...serverFilterSchema,
  name: z.string().optional(),
  file: z.string().optional(),
  line: z.number().optional(),
  character: z.number().optional(),
  position: z.string().optional(),
});

export async function handleHover(ctx: LocusServerContext, args: unknown): Promise<CallToolResult> {
  const input = hoverSchema.parse(args ?? {});
  const filterError = serverFilterError(ctx, input);
  if (filterError) return textResult(filterError);
  const pos = parsePosition(input.position);

  let file = pos?.file ?? input.file;
  let line = pos?.line ?? input.line;
  let character = pos?.character ?? input.character;

  if (file) {
    const resolvedFile = await ctx.manager.resolveFile(file, input);
    if (resolvedFile.status !== "ok") {
      return textResult(resolvedFile);
    }
    file = resolvedFile.file;
  }

  if (input.name && file) {
    const clients = await ctx.manager.getClientsForFile(file, input);
    if (clients.length === 0) {
      return textResult(errorResult("server_unavailable", `No LSP for ${file}`));
    }

    const resolved = await ctx.resolver.findByName(clients, input.name, file);
    if (resolved.failures.length === clients.length) {
      return textResult(allFailedResult(resolved.failures));
    }

    if (resolved.status !== "ok" || resolved.symbols.length === 0) {
      return textResult(
        withFailures(
          errorResult(resolved.status === "ambiguous_symbol" ? "ambiguous_symbol" : "no_results", resolved.message ?? "Symbol not found"),
          resolved.failures,
        ),
      );
    }

    const sym = resolved.symbols[0]!;
    file = sym.filePath;
    line = sym.line;
    character = sym.character;
  }

  if (!file || line === undefined || character === undefined) {
    return textResult(errorResult("error", "Provide file+position or name+file"));
  }

  const clients = await ctx.manager.getClientsForFile(file, input);
  if (clients.length === 0) {
    return textResult(errorResult("server_unavailable", `No LSP for ${file}`));
  }

  const { results, failures } = await fanOut(clients, (client) => client.hover(file, line, character));
  if (results.length === 0) {
    return textResult(allFailedResult(failures));
  }

  const markdown = formatHovers(results.map(({ client, value }) => ({ server: client.id, hover: value })));
  return textResult(withFailures(okResult(markdown), failures));
}

function textResult(result: { status: string; data?: string; message?: string }): CallToolResult {
  const parts = [`status: ${result.status}`];
  if (result.message) parts.push(result.message);
  if (result.data) parts.push("", result.data);
  return {
    content: [{ type: "text", text: parts.join("\n") }],
    isError: result.status !== "ok",
  };
}
