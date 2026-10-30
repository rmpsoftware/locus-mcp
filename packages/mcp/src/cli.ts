#!/usr/bin/env node
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  loadConfig,
  generateDefaultConfig,
  configToToml,
  configToJson,
  detectProjectLanguages,
} from "@rmpsoftware/locus-core";
import { createLocusContext, shutdownContext } from "./context.js";
import { runMcpServer } from "./server.js";

const HELP = `
Locus — agent-first LSP code intelligence

Usage:
  locus serve [--cwd <path>]     Start MCP server (stdio)
  locus init [--cwd <path>]      Generate locus.toml + locus.json
  locus check [--cwd <path>]     Check LSP binary availability
  locus warm [--cwd <path>]      Pre-warm language servers

Options:
  --cwd <path>   Project root (default: current directory)
  --help, -h     Show this help
`.trim();

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { command, cwd } = parseArgs(argv);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
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
    if (arg === "--cwd" && argv[i + 1]) {
      cwd = resolve(argv[++i]!);
    } else if (!arg.startsWith("-") && !command) {
      command = arg;
    }
  }

  return { command, cwd };
}

async function runInit(cwd: string): Promise<void> {
  const rootPath = resolve(cwd);
  if (!existsSync(rootPath)) {
    mkdirSync(rootPath, { recursive: true });
  }
  const config = generateDefaultConfig(rootPath);
  const tomlPath = join(rootPath, "locus.toml");
  const jsonPath = join(rootPath, "locus.json");

  if (!existsSync(tomlPath)) {
    writeFileSync(tomlPath, configToToml(config), "utf8");
    console.log(`Created ${tomlPath}`);
  } else {
    console.log(`Already exists: ${tomlPath}`);
  }

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
  const { config } = loadConfig(cwd);
  const ctx = createLocusContext(cwd);

  const langs = config.warm ?? detectProjectLanguages(ctx.rootPath);
  console.log(`Warming: ${langs.join(", ") || "all servers"}`);

  await ctx.manager.warm(langs.length ? langs : undefined);
  const statuses = await ctx.manager.status();

  for (const s of statuses) {
    console.log(`- ${s.id}: ${s.state}${s.warmed ? " (warmed)" : ""}`);
  }

  await shutdownContext(ctx);
}
