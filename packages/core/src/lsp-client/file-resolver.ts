import { statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type FileResolution =
  | { status: "ok"; file: string }
  | { status: "file_not_found"; message: string }
  | { status: "ambiguous_file"; message: string; data: string };

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function isIgnoredDirectory(name: string, ignoreDirectories: string[] = []): boolean {
  return name.startsWith(".") || ignoreDirectories.includes(name);
}

export async function findFilesByName(root: string, name: string, ignoreDirectories?: string[]): Promise<string[]> {
  const found: string[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const dir = pending.pop()!;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!isIgnoredDirectory(entry.name, ignoreDirectories)) {
          pending.push(join(dir, entry.name));
        }
      } else if (entry.isFile() && entry.name === name) {
        found.push(join(dir, entry.name));
      }
    }
  }

  return found;
}
