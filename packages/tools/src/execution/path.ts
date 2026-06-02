import { resolve } from "node:path";

export function resolveToolPath(cwd: string, input: unknown): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error("Tool argument 'path' must be a non-empty string.");
  }
  return resolve(cwd, input);
}
