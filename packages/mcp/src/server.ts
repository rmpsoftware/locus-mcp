import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createLocusContext, shutdownContext, type LocusServerContext } from "./context.js";
import { locateTool, handleLocate } from "./tools/locate.js";
import { refsTool, handleRefs } from "./tools/refs.js";
import { hoverTool, handleHover } from "./tools/hover.js";
import { diagnosticsTool, handleDiagnostics } from "./tools/diagnostics.js";
import { statusTool, handleStatus } from "./tools/status.js";
import { renameTool, handleRename } from "./tools/rename.js";
import { listProjectsTool, handleListProjects } from "./tools/list-projects.js";

const TOOLS = [locateTool, refsTool, hoverTool, diagnosticsTool, statusTool, renameTool, listProjectsTool];

export type { LocusServerContext } from "./context.js";

export async function createLocusServer(cwd?: string): Promise<{ server: Server; ctx: LocusServerContext }> {
  const ctx = createLocusContext(cwd);
  const server = new Server(
    { name: "locus", version: "0.1.5" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "locate":
          return await handleLocate(ctx, args);
        case "refs":
          return await handleRefs(ctx, args);
        case "hover":
          return await handleHover(ctx, args);
        case "diagnostics":
          return await handleDiagnostics(ctx, args);
        case "status":
          return await handleStatus(ctx, args);
        case "rename":
          return await handleRename(ctx, args);
        case "list_projects":
          return await handleListProjects(ctx);
        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `error: ${message}` }],
        isError: true,
      };
    }
  });

  return { server, ctx };
}

export async function runMcpServer(cwd?: string): Promise<void> {
  const { server, ctx } = await createLocusServer(cwd);
  const transport = new StdioServerTransport();

  process.on("SIGINT", async () => {
    await shutdownContext(ctx);
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await shutdownContext(ctx);
    process.exit(0);
  });

  await server.connect(transport);
}
