import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

const UNICODE_SPACES = /[\u00a0\u2007\u202f]/g;

export function expandToolPathInput(input: string): string {
  let path = input.trim().replace(UNICODE_SPACES, " ").normalize("NFC");
  if (path.startsWith("@")) path = path.slice(1);
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

export function resolveToCwd(cwd: string, input: string): string {
  const expanded = expandToolPathInput(input);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

export function resolveToolPath(cwd: string, input: unknown): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error("Tool argument 'path' must be a non-empty string.");
  }
  return resolveToCwd(cwd, input);
}

export function isErrnoException(
  error: unknown,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function pathNotFoundMessage(
  toolName: string,
  input: unknown,
  resolvedPath: string,
): string {
  const label = typeof input === "string" ? JSON.stringify(input) : "path";
  return `${toolName} path not found: ${label} (resolved to ${resolvedPath}).`;
}

export async function resolveReadPath(
  cwd: string,
  input: unknown,
): Promise<string> {
  const initial = resolveToolPath(cwd, input);
  const candidates = readPathCandidates(initial);
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return initial;
}

function readPathCandidates(path: string): string[] {
  const variants = new Set<string>([
    path,
    path.normalize("NFC"),
    path.normalize("NFD"),
  ]);
  for (const value of [...variants]) {
    variants.add(value.replace(UNICODE_SPACES, " "));
  }
  // macOS screenshots sometimes use narrow no-break spaces before AM/PM.
  for (const value of [...variants]) {
    variants.add(value.replace(/ ([AP]M)(\.[^./]+)?$/u, "\u202f$1$2"));
    variants.add(value.replace(/\u202f([AP]M)(\.[^./]+)?$/u, " $1$2"));
    variants.add(value.replace(/[’‘]/g, "'"));
    variants.add(value.replace(/'/g, "’"));
  }
  return [...variants].filter((candidate) => candidate.length > 0);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
