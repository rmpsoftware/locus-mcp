#!/usr/bin/env node
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  generateDefaultConfig,
  configToJson,
  detectProjectLanguages,
} from "@rmpsoftware/locus-core";
import { createLocusContext, shutdownContext } from "./context.js";
import { runMcpServer } from "./server.js";

const HELP = `
Locus — agent-first LSP code intelligence

Usage:
  locus serve [--cwd <path>]     Start MCP server (stdio)
  locus init [--cwd <path>]      Generate locus.json
  locus check [--cwd <path>]     Check LSP binary availability
  locus warm [--cwd <path>]      Pre-warm language servers

Options:
  --cwd <path>   Working directory and project root (default: current directory)
  --help, -h     Show this help
`.trim();

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { command, cwd } = parseArgs(argv);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  if (command === "serve" || command === "init" || command === "check" || command === "warm") {
    if (command === "init") mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
  }

  switch (command) {
    case "serve":
      await runMcpServer(cwd);
      break;
    case "init":
      await runInit(cwd);
      break;
    case "check":
      await runCheck(cwd);
      break;
    case "warm":
      await runWarm(cwd);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

function parseArgs(argv: string[]): { command?: string; cwd: string } {
  let command: string | undefined;
  let cwd = process.cwd();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--cwd") {
      const path = argv[++i];
      if (!path || path.startsWith("--")) throw new Error("--cwd requires a path");
      cwd = resolve(path);
    } else if (!arg.startsWith("-") && !command) {
      command = arg;
    }
  }

  return { command, cwd };
}

async function runInit(cwd: string): Promise<void> {
  const rootPath = resolve(cwd);
  const config = generateDefaultConfig(rootPath);
  const jsonPath = join(rootPath, "locus.json");

  if (!existsSync(jsonPath)) {
    writeFileSync(jsonPath, configToJson(config), "utf8");
    console.log(`Created ${jsonPath}`);
  } else {
    console.log(`Already exists: ${jsonPath}`);
  }

  const langs = detectProjectLanguages(rootPath);
  console.log(`Detected languages: ${langs.length ? langs.join(", ") : "none (using defaults)"}`);
}

async function runCheck(cwd: string): Promise<void> {
  const ctx = createLocusContext(cwd);
  const statuses = await ctx.manager.status();

  let hasMissing = false;
  for (const s of statuses) {
    const icon = s.binaryAvailable ? "✓" : "✗";
    console.log(`${icon} ${s.id}: ${s.command} (${s.binaryAvailable ? "found" : "MISSING"})`);
    if (!s.binaryAvailable) hasMissing = true;
  }

  await shutdownContext(ctx);
  process.exit(hasMissing ? 1 : 0);
}

async function runWarm(cwd: string): Promise<void> {
  const ctx = createLocusContext(cwd);

  if (ctx.configs.some((server) => server.warm !== undefined)) {
    const targets = ctx.configs.filter((server) => server.warm === true);
    console.log(`Warming: ${targets.map((server) => server.id).join(", ") || "no servers"}`);
    await ctx.manager.warmConfigured();
  } else {
    const langs = detectProjectLanguages(ctx.rootPath);
    console.log(`Warming: ${langs.join(", ") || "all servers"}`);
    await ctx.manager.warm(langs.length ? langs : undefined);
  }
  const statuses = await ctx.manager.status();

  for (const s of statuses) {
    console.log(`- ${s.id}: ${s.state}${s.warmed ? " (warmed)" : ""}`);
  }

  await shutdownContext(ctx);
}
