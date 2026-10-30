import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fanOut, formatLocations, mergeLocations, okResult, errorResult } from "@rmpsoftware/locus-core";
import type { LocusServerContext } from "../context.js";
import { allFailedResult, FILE_PATH_HINT, parsePosition, SERVER_FILTER_PROPERTIES, serverFilterError, serverFilterSchema, withFailures } from "./helpers.js";

export const refsTool = {
  name: "refs",
  description: "Find references or implementations of a symbol. Accepts symbol name (via prior locate) or file:line:col position.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ...SERVER_FILTER_PROPERTIES,
      file: { type: "string", description: `File containing the symbol. ${FILE_PATH_HINT}` },
      line: { type: "number", description: "0-based line number" },
      character: { type: "number", description: "0-based character offset" },
      position: { type: "string", description: "Alternative: path:line:col (1-based line/col)" },
      implementations: { type: "boolean", description: "Find implementations instead of references" },
      include_declaration: { type: "boolean", description: "Include declaration in references (default true)" },
      limit: { type: "number", description: "Max results (default 50)" },
    },
    required: ["file"],
  },
};

const refsSchema = z.object({
  ...serverFilterSchema,
  file: z.string(),
  line: z.number().optional(),
  character: z.number().optional(),
  position: z.string().optional(),
  implementations: z.boolean().optional(),
  include_declaration: z.boolean().optional(),
  limit: z.number().optional(),
});

export async function handleRefs(ctx: LocusServerContext, args: unknown): Promise<CallToolResult> {
  const input = refsSchema.parse(args ?? {});
  const filterError = serverFilterError(ctx, input);
  if (filterError) return textResult(filterError);
  const pos = parsePosition(input.position);
  const line = pos?.line ?? input.line;
  const character = pos?.character ?? input.character;

  if (line === undefined || character === undefined) {
    return textResult(errorResult("error", "Provide line/character or position (path:line:col)"));
  }

  const resolved = await ctx.manager.resolveFile(pos?.file ?? input.file, input);
  if (resolved.status !== "ok") {
    return textResult(resolved);
  }

  const { file } = resolved;
  const clients = await ctx.manager.getClientsForFile(file, input);
  if (clients.length === 0) {
    return textResult(errorResult("server_unavailable", `No LSP for ${file}`));
  }

  const { results, failures } = await fanOut(clients, (client) =>
    input.implementations
      ? client.implementation(file, line, character)
      : client.references(file, line, character, input.include_declaration ?? true),
  );
  if (results.length === 0) {
    return textResult(allFailedResult(failures));
  }

  const locations = mergeLocations(results.map((r) => r.value));
  if (locations.length === 0) {
    return textResult(withFailures(errorResult("no_results", "No references found"), failures));
  }

  const limit = input.limit ?? 50;
  const limited = locations.slice(0, limit);
  const formatted = formatLocations(limited, ctx.rootPath);

  let text = formatted.join("\n");
  if (locations.length > limit) {
    text += `\n\n... ${locations.length - limit} more (use limit param)`;
  }

  return textResult(withFailures(okResult(text, `${locations.length} result(s)`), failures));
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
