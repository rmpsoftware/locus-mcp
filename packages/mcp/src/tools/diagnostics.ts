import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  fanOut,
  formatDiagnostics,
  formatWorkspaceDiagnostics,
  mergeDiagnostics,
  okResult,
  errorResult,
  Diagnostic,
} from "@rmpsoftware/locus-core";
import type { LocusServerContext } from "../context.js";
import { allFailedResult, FILE_PATH_HINT, SERVER_FILTER_PROPERTIES, serverFilterError, serverFilterSchema, withFailures } from "./helpers.js";

export const diagnosticsTool = {
  name: "diagnostics",
  description: "Get compiler/linter diagnostics for a file or the entire workspace.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ...SERVER_FILTER_PROPERTIES,
      file: { type: "string", description: `${FILE_PATH_HINT}. Omit for workspace-wide` },
      workspace: { type: "boolean", description: "Collect from all open documents" },
    },
  },
};

const diagnosticsSchema = z.object({
  ...serverFilterSchema,
  file: z.string().optional(),
  workspace: z.boolean().optional(),
});

export async function handleDiagnostics(ctx: LocusServerContext, args: unknown): Promise<CallToolResult> {
  const input = diagnosticsSchema.parse(args ?? {});
  const filterError = serverFilterError(ctx, input);
  if (filterError) return textResult(filterError);

  if (input.file) {
    const resolved = await ctx.manager.resolveFile(input.file, input);
    if (resolved.status !== "ok") {
      return textResult(resolved);
    }

    const filePath = resolved.file;
    const clients = await ctx.manager.getClientsForFile(filePath, input);
    if (clients.length === 0) {
      return textResult(errorResult("server_unavailable", `No LSP for ${input.file}`));
    }

    const { results, failures } = await fanOut(clients, (client) => client.collectDiagnostics(filePath));
    if (results.length === 0) {
      return textResult(allFailedResult(failures));
    }

    const diags = mergeDiagnostics(results.map((r) => r.value));
    const text = formatDiagnostics(diags, filePath, ctx.rootPath);
    return textResult(withFailures(okResult(text, `${diags.length} diagnostic(s)`), failures));
  }

  // Workspace diagnostics from all active clients
  const byFile = new Map<string, Diagnostic[]>();

  for (const client of ctx.manager.getRunningClients(input)) {
    for (const doc of client.getOpenDocuments()) {
      const diags = client.getDiagnostics(doc.uri);
      if (diags.length) {
        byFile.set(doc.uri, mergeDiagnostics([byFile.get(doc.uri) ?? [], diags]));
      }
    }
  }

  if (byFile.size === 0) {
    return textResult(okResult("No workspace diagnostics. Open files with locate/refs first, or pass a file path."));
  }

  const text = formatWorkspaceDiagnostics(byFile, ctx.rootPath);
  return textResult(okResult(text));
}

function textResult(result: { status: string; data?: string; message?: string }): CallToolResult {
  const parts = [`status: ${result.status}`];
  if (result.message) parts.push(result.message);
  if (result.data) parts.push("", result.data);
  return {
    content: [{ type: "text", text: parts.join("\n") }],
    isError: result.status !== "ok" && result.status !== "no_results",
  };
}
