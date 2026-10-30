import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatStatus } from "@rmpsoftware/locus-core";
import type { LocusServerContext } from "../context.js";

export const statusTool = {
  name: "status",
  description: "Check language server readiness, warm state, and missing binaries.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export async function handleStatus(ctx: LocusServerContext, _args: unknown): Promise<CallToolResult> {
  const statuses = await ctx.manager.status();
  const text = formatStatus(statuses);

  const missing = statuses.filter((s) => !s.binaryAvailable).map((s) => s.command);
  const starting = statuses.filter((s) => s.state === "starting").map((s) => s.id);

  let message: string | undefined;
  if (missing.length) {
    message = `Missing binaries: ${missing.join(", ")}. Install them or override in locus.json.`;
  } else if (starting.length) {
    message = `Servers starting: ${starting.join(", ")}. Retry shortly.`;
  }

  return {
    content: [{ type: "text", text: [`status: ok`, message, "", text].filter(Boolean).join("\n") }],
    isError: false,
  };
}
