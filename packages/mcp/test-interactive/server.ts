#!/usr/bin/env node
// Runs the Locus MCP server in-process and exposes it over HTTP for curl/Postman.
//
//   node --import tsx packages/mcp/test-interactive/server.ts [--cwd <workspace>] [--port 3333]
//
//   GET  /tools           -> list tools (with input schemas)
//   POST /tools/:name     -> call tool; JSON body = arguments
import { createServer, type IncomingMessage } from "node:http";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLocusServer } from "../src/server";
import { shutdownContext } from "../src/context";

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1]! : fallback;
};
const cwd = resolve(option("cwd", process.cwd()));
const port = Number(option("port", process.env.PORT ?? "3333"));

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk.toString();
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

const { server: locusServer, ctx } = await createLocusServer(cwd);
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "test-interactive", version: "0.0.0" });
await locusServer.connect(serverTransport);
await client.connect(clientTransport);

const httpServer = createServer(async (req, res) => {
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body, null, 2));
  };

  try {
    const { pathname: raw } = new URL(req.url ?? "/", "http://localhost");
    const pathname = raw.replace(/\/+$/, "") || "/";
    if (req.method === "GET" && pathname === "/tools") {
      send(200, await client.listTools());
      return;
    }

    const match = pathname.match(/^\/(?:tools\/)?([\w.-]+)$/);
    if (req.method === "POST" && match && match[1] !== "tools") {
      send(200, await client.callTool({ name: match[1], arguments: await readJson(req) }));
      return;
    }

    send(404, {
      error: `no route for ${req.method} ${raw}`,
      routes: ["GET /tools", "POST /tools/:name (JSON body = tool arguments)"],
    });
  } catch (error) {
    send(500, { error: error instanceof Error ? error.message : String(error) });
  }
});

await new Promise<void>((resolve, reject) => {
  httpServer.once("error", reject);
  httpServer.listen(port, "127.0.0.1", () => {
    httpServer.off("error", reject);
    resolve();
  });
});

console.log(`locus-mcp (cwd: ${ctx.rootPath}) on http://127.0.0.1:${port}`);
console.log(`  curl localhost:${port}/tools`);
console.log(`  curl -X POST localhost:${port}/tools/status -d '{}'`);

let shutdownPromise: Promise<void> | undefined;
const shutdown = (): Promise<void> => {
  shutdownPromise ??= (async () => {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve());
    });
    await client.close();
    await locusServer.close();
    await shutdownContext(ctx);
  })();
  return shutdownPromise;
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().catch((error: unknown) => {
      console.error("Failed to shut down interactive Locus server:", error);
      process.exitCode = 1;
    });
  });
}
