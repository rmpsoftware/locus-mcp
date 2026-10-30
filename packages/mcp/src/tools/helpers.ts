import type { LocusResult, ServerFailure } from "@rmpsoftware/locus-core";
import { z } from "zod";
import type { LocusServerContext } from "../context.js";

export const FILE_PATH_HINT = "Absolute path, path relative to the project or a server root, or a bare filename";
export const SERVER_FILTER_PROPERTIES = {
  project: { type: "string", minLength: 1, description: "Restrict to the server configuration with this project ID" },
  lang: { type: "string", minLength: 1, description: "Restrict to the server configuration with this language ID" },
} as const;
export const serverFilterSchema = {
  project: z.string().min(1).optional(),
  lang: z.string().min(1).optional(),
};

export function serverFilterError(
  ctx: LocusServerContext,
  filter: { project?: string; lang?: string },
): LocusResult | undefined {
  if (filter.project === undefined && filter.lang === undefined) return undefined;
  if (ctx.configs.some((config) =>
    (filter.project === undefined || config.id === filter.project) &&
    (filter.lang === undefined || config.languageId === filter.lang),
  )) return undefined;
  return {
    status: "server_unavailable",
    message: `No server configuration matches${filter.project !== undefined ? ` project "${filter.project}"` : ""}${filter.lang !== undefined ? ` lang "${filter.lang}"` : ""}`,
  };
}

export function handleLspError(err: unknown): LocusResult {
  const message = err instanceof Error ? err.message : String(err);

  if (message === "server_starting") {
    return { status: "server_starting", message: "Language server is still starting. Retry in a few seconds or call status/warm." };
  }

  if (message === "server_unavailable") {
    return { status: "server_unavailable", message: "Language server is unavailable. Run `locus check` to verify binaries." };
  }

  if (message.includes("timed out")) {
    return { status: "server_starting", message: message };
  }

  return { status: "error", message };
}

export function allFailedResult(failures: ServerFailure[]): LocusResult {
  const results = failures.map((f) => handleLspError(f.error));
  if (results.length === 1) return results[0]!;

  const retryable = results.find((r) => r.status === "server_starting");
  return { status: (retryable ?? results[0]!).status, message: describeFailures(failures) };
}

export function withFailures<T>(result: LocusResult<T>, failures: ServerFailure[]): LocusResult<T> {
  if (failures.length === 0) return result;
  return { ...result, message: [result.message, describeFailures(failures)].filter(Boolean).join("\n") };
}

function describeFailures(failures: ServerFailure[]): string {
  return failures
    .map(({ client, error }) => {
      const { status, message } = handleLspError(error);
      return `${client.id} failed (${status}): ${message}`;
    })
    .join("\n");
}

export function parsePosition(input?: string): { file: string; line: number; character: number } | undefined {
  if (!input) return undefined;

  const match = input.match(/^(.+?):(\d+):(\d+)$/);
  if (!match) return undefined;

  return {
    file: match[1]!,
    line: Number.parseInt(match[2]!, 10) - 1,
    character: Number.parseInt(match[3]!, 10) - 1,
  };
}
