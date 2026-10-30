import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  fanOut,
  formatRenamePreview,
  mergeWorkspaceEdits,
  okResult,
  errorResult,
} from "@rmpsoftware/locus-core";
import type { LocusServerContext } from "../context.js";
import { allFailedResult, FILE_PATH_HINT, parsePosition, SERVER_FILTER_PROPERTIES, serverFilterError, serverFilterSchema, withFailures } from "./helpers.js";

export const renameTool = {
  name: "rename",
  description: "Preview or apply a symbol rename. Defaults to dry-run preview; set apply=true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ...SERVER_FILTER_PROPERTIES,
      file: { type: "string", description: `File containing the symbol. ${FILE_PATH_HINT}` },
      line: { type: "number", description: "0-based line" },
      character: { type: "number", description: "0-based character" },
      position: { type: "string", description: "Alternative: path:line:col (1-based)" },
      new_name: { type: "string", description: "New symbol name" },
      apply: { type: "boolean", description: "Apply rename (default false = preview only)" },
    },
    required: ["new_name"],
  },
};

const renameSchema = z.object({
  ...serverFilterSchema,
  file: z.string().optional(),
  line: z.number().optional(),
  character: z.number().optional(),
  position: z.string().optional(),
  new_name: z.string(),
  apply: z.boolean().optional(),
});

export async function handleRename(ctx: LocusServerContext, args: unknown): Promise<CallToolResult> {
  const input = renameSchema.parse(args ?? {});
  const filterError = serverFilterError(ctx, input);
  if (filterError) return textResult(filterError);
  const pos = parsePosition(input.position);
  const target = pos?.file ?? input.file;
  const line = pos?.line ?? input.line;
  const character = pos?.character ?? input.character;

  if (!target || line === undefined || character === undefined) {
    return textResult(errorResult("error", "Provide file+position or position string"));
  }

  const resolved = await ctx.manager.resolveFile(target, input);
  if (resolved.status !== "ok") {
    return textResult(resolved);
  }

  const { file } = resolved;
  const clients = await ctx.manager.getClientsForFile(file, input);
  if (clients.length === 0) {
    return textResult(errorResult("server_unavailable", `No LSP for ${file}`));
  }

  const { results, failures } = await fanOut(clients, async (client) => {
    const prepared = await client.prepareRename(file, line, character);
    return prepared ? client.rename(file, line, character, input.new_name) : undefined;
  });
  if (results.length === 0) {
    return textResult(allFailedResult(failures));
  }

  if (results.every((r) => r.value === undefined)) {
    return textResult(withFailures(errorResult("no_results", "Symbol cannot be renamed at this position"), failures));
  }

  const changes = mergeWorkspaceEdits(results.flatMap((r) => (r.value ? [r.value] : [])));
  if (Object.keys(changes).length === 0) {
    return textResult(withFailures(errorResult("no_results", "Rename produced no changes"), failures));
  }

  const preview = formatRenamePreview(changes, ctx.rootPath);

  if (!input.apply) {
    return textResult(withFailures(okResult(preview, "Dry run — set apply=true to execute"), failures));
  }

  // MVP: report preview; actual file writes delegated to host agent
  return textResult(
    withFailures(
      okResult(
        `${preview}\n\nNote: apply=true returns the edit plan. Apply edits via host Edit tool.`,
        "Rename plan generated",
      ),
      failures,
    ),
  );
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
