/**
 * Minimal fake language server for unit tests.
 * Speaks JSON-RPC over stdin/stdout with Content-Length framing.
 * An optional first argument labels this server's hover and diagnostics.
 */
const CRLF = "\r\n";
const label = process.argv[2];
let openedUri;
let buffer = Buffer.alloc(0);
let contentLength = -1;

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (parseMessages()) {
    /* drain */
  }
});

function parseMessages() {
  if (contentLength < 0) {
    const headerEnd = buffer.indexOf(`${CRLF}${CRLF}`);
    if (headerEnd === -1) return false;

    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      return true;
    }

    contentLength = Number.parseInt(match[1], 10);
    buffer = buffer.subarray(headerEnd + 4);
  }

  if (buffer.length < contentLength) return false;

  const body = buffer.subarray(0, contentLength).toString("utf8");
  buffer = buffer.subarray(contentLength);
  contentLength = -1;

  try {
    handleMessage(JSON.parse(body));
  } catch {
    /* ignore malformed input in tests */
  }

  return true;
}

function handleMessage(message) {
  if (message.method && message.id === undefined) {
    if (label === "exit-on-initialized" && message.method === "initialized") process.exit(1);
    if (label && label !== "pull" && (message.method === "textDocument/didOpen" || message.method === "textDocument/didChange")) {
      const { uri, version } = message.params.textDocument;
      openedUri = uri;
      setTimeout(() => publishDiagnostics(uri, version), label === "beta" ? 350 : 0);
    }
    return;
  }

  if (message.id === undefined) return;

  const { id, method, params } = message;
  let result = null;

  switch (method) {
    case "initialize":
      result = {
        capabilities: label === "pull" ? { diagnosticProvider: { identifier: "fake" } } : {},
        serverInfo: { name: "fake-lsp", version: "1.0.0" },
      };
      break;
    case "textDocument/diagnostic":
      result = {
        kind: "full",
        items: [{
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: "pull problem",
        }],
      };
      break;
    case "workspace/symbol":
      result = [
        {
          name: params?.query ?? "Symbol",
          kind: 12,
          location: {
            uri: process.argv[3] === "workspace-open-file" && openedUri ? openedUri : "file:///proj/src/index.ts",
            range: {
              start: { line: 4, character: 2 },
              end: { line: 4, character: 10 },
            },
          },
        },
      ];
      break;
    case "textDocument/documentSymbol":
      result = [
        {
          name: "Greeter",
          kind: 5,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 5, character: 1 },
          },
          selectionRange: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 13 },
          },
        },
      ];
      break;
    case "textDocument/references":
      result = [
        {
          uri: "file:///proj/src/index.ts",
          range: {
            start: { line: 10, character: 4 },
            end: { line: 10, character: 12 },
          },
        },
      ];
      break;
    case "textDocument/implementation":
      result = [
        {
          uri: "file:///proj/src/impl.ts",
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 8 },
          },
        },
      ];
      break;
    case "textDocument/hover":
      result = { contents: { kind: "markdown", value: label ? `**${label}**` : "**string**" } };
      break;
    case "textDocument/prepareRename":
      result = {
        range: {
          start: { line: 4, character: 2 },
          end: { line: 4, character: 10 },
        },
      };
      break;
    case "textDocument/rename":
      result = {
        changes: {
          "file:///proj/src/index.ts": [
            {
              range: {
                start: { line: 4, character: 2 },
                end: { line: 4, character: 10 },
              },
              newText: params?.newName ?? "renamed",
            },
          ],
        },
      };
      break;
    case "textDocument/definition":
      result = {
        uri: "file:///proj/src/types.ts",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 6 },
        },
      };
      break;
    case "shutdown":
      result = null;
      break;
    default:
      result = null;
  }

  send({ jsonrpc: "2.0", id, result });
}

function publishDiagnostics(uri, version) {
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
  send({
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: {
      uri,
      version,
      diagnostics: [
        { range, severity: 1, message: "shared problem" },
        { range, severity: 2, message: `${label} problem` },
      ],
    },
  });
}

function send(message) {
  const body = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}${CRLF}${CRLF}`;
  process.stdout.write(header + body, "utf8");
}
