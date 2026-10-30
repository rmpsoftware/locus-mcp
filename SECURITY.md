# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Locus, please report it responsibly.

**Do not open a public GitHub issue for security-sensitive reports.**

Instead, email **fernando@paladini.dev** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact (e.g. arbitrary code execution, credential exposure)
- Your suggested fix, if any

You should receive a response within **72 hours**. We will coordinate disclosure and credit you in the release notes unless you prefer to remain anonymous.

## Scope

In scope:

- `@rmpsoftware/locus-core` and `@rmpsoftware/locus-mcp` packages
- MCP tool handlers and CLI commands
- LSP process spawning and configuration loading

Out of scope:

- Vulnerabilities in third-party language servers (TypeScript LS, Pyright, gopls, rust-analyzer)
- Issues in MCP host applications (Cursor, Claude Code, VS Code)

## Safe Defaults

Locus runs language servers as child processes with stdio transport. It does not execute arbitrary shell commands from config beyond spawning configured `command` + `args`. Always review `locus.json` / `.lsp.json` before trusting a project.
