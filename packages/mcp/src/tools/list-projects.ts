import { resolve } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { LocusServerContext } from "../context.js";

export const listProjectsTool = {
  name: "list_projects",
  description: "List configured projects, their server roots, and language IDs.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export async function handleListProjects(ctx: LocusServerContext): Promise<CallToolResult> {
  const projects = ctx.configs.map((config) => ({
    project: config.id,
    root: resolve(ctx.rootPath, config.root ?? "."),
    language: config.languageId,
  }));
  return {
    content: [{ type: "text", text: JSON.stringify(projects) }],
    isError: false,
  };
}
