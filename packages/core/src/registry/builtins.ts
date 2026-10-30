import type { LanguageServerConfig } from "./registry.js";

export const BUILTIN_SERVERS: LanguageServerConfig[] = [
  {
    id: "typescript",
    languageId: "typescript",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"],
    command: "typescript-language-server",
    args: ["--stdio"],
    ignoreDirectories: ["node_modules", "dist", "build"],
  },
  {
    id: "python",
    languageId: "python",
    extensions: [".py", ".pyi"],
    command: "pyright-langserver",
    args: ["--stdio"],
    ignoreDirectories: ["__pycache__"],
  },
  {
    id: "go",
    languageId: "go",
    extensions: [".go"],
    command: "gopls",
    args: [],
  },
  {
    id: "rust",
    languageId: "rust",
    extensions: [".rs"],
    command: "rust-analyzer",
    args: [],
    ignoreDirectories: ["target"],
  },
];

export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
};
