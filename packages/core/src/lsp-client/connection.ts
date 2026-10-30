import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL } from "node:url";
import type {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  PublishDiagnosticsParams,
} from "./types.js";

const HEADER = "Content-Length: ";
const CRLF = "\r\n";

export interface LspConnectionOptions {
  command: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class LspConnection {
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private buffer = Buffer.alloc(0);
  private contentLength = -1;
  private readonly requestTimeoutMs: number;
  private readonly onNotification?: (method: string, params: unknown) => void;
  private readonly onExit?: (code: number | null) => void;
  private exited = false;

  constructor(
    private readonly options: LspConnectionOptions,
    handlers?: {
      onNotification?: (method: string, params: unknown) => void;
      onExit?: (code: number | null) => void;
    },
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.onNotification = handlers?.onNotification;
    this.onExit = handlers?.onExit;
  }

  get isRunning(): boolean {
    return this.process !== null && !this.exited;
  }

  async start(): Promise<void> {
    if (this.process) return;

    this.exited = false;
    this.buffer = Buffer.alloc(0);
    this.contentLength = -1;
    this.process = spawn(this.options.command, this.options.args ?? [], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    this.process.stdout.on("data", (chunk: Buffer) => {
      this.handleData(chunk);
    });

    this.process.stderr.on("data", (chunk: Buffer) => {
      // Language servers often log to stderr; keep for debugging only.
      if (process.env.LOCUS_DEBUG) {
        process.stderr.write(`[lsp stderr] ${chunk.toString("utf8")}`);
      }
    });

    this.process.on("exit", (code) => {
      this.exited = true;
      this.rejectAllPending(new Error(`LSP process exited with code ${code}`));
      this.onExit?.(code);
    });

    this.process.on("error", (err) => {
      this.exited = true;
      this.rejectAllPending(err);
    });
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    const proc = this.process;
    this.process = null;
    proc.kill();
    await new Promise<void>((resolve) => {
      proc.once("exit", () => resolve());
      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        resolve();
      }, 2000);
    });
  }

  async request<T = unknown>(method: string, params?: unknown, timeoutMs = this.requestTimeoutMs): Promise<T> {
    if (!this.process?.stdin.writable) {
      throw new Error("LSP process is not running");
    }

    const id = this.nextId++;
    const message: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      this.writeMessage(message);
    });
  }

  notify(method: string, params?: unknown): void {
    if (!this.process?.stdin.writable) {
      throw new Error("LSP process is not running");
    }
    this.writeMessage({ jsonrpc: "2.0", method, params });
  }

  private writeMessage(message: JsonRpcMessage): void {
    const body = JSON.stringify(message);
    const header = `${HEADER}${Buffer.byteLength(body, "utf8")}${CRLF}${CRLF}`;
    this.process!.stdin.write(header + body, "utf8");
  }

  private handleData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);

    while (true) {
      if (this.contentLength < 0) {
        const headerEnd = this.buffer.indexOf(`${CRLF}${CRLF}`);
        if (headerEnd === -1) return;

        const header = this.buffer.subarray(0, headerEnd).toString("utf8");
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          this.buffer = this.buffer.slice(headerEnd + 4);
          continue;
        }

        this.contentLength = Number.parseInt(match[1]!, 10);
        this.buffer = this.buffer.slice(headerEnd + 4);
      }

      if (this.buffer.length < this.contentLength) return;

      const body = this.buffer.subarray(0, this.contentLength).toString("utf8");
      this.buffer = this.buffer.slice(this.contentLength);
      this.contentLength = -1;

      try {
        const message = JSON.parse(body) as JsonRpcMessage;
        this.handleMessage(message);
      } catch (err) {
        if (process.env.LOCUS_DEBUG) {
          process.stderr.write(`[locus] Failed to parse LSP message: ${err}\n`);
        }
      }
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if ("method" in message && message.method) {
      if (!("id" in message) || message.id === undefined) {
        this.onNotification?.(message.method, message.params);
      } else if (message.method === "window/workDoneProgress/create") {
        const params = message.params;
        const token = params && typeof params === "object" && "token" in params ? params.token : undefined;
        if (typeof token === "string" || typeof token === "number") {
          this.writeMessage({ jsonrpc: "2.0", id: message.id, result: null });
        } else {
          this.writeMessage({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Invalid progress token" } });
        }
      } else {
        this.writeMessage({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
      }
      return;
    }

    const response = message as JsonRpcResponse;
    if (response.id === undefined || response.id === null) return;

    const pending = this.pending.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error.message));
      return;
    }

    pending.resolve(response.result);
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function filePathToUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    return pathToFileURL(normalized).href;
  }
  // Windows drive letter paths
  return pathToFileURL(filePath).href;
}

export function uriToFilePath(uri: string): string {
  if (uri.startsWith("file://")) {
    const url = new URL(uri);
    let path = decodeURIComponent(url.pathname);
    if (process.platform === "win32") {
      if (path.startsWith("/")) {
        path = path.slice(1);
      }
      return path.replace(/\//g, "\\");
    }
    return path;
  }
  return uri;
}

export type DiagnosticsHandler = (params: PublishDiagnosticsParams) => void;
