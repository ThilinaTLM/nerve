import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import { resolveNativePath } from "./native-path.js";

const UNICODE_SPACES = /[\u00a0\u2007\u202f]/g;

export function expandToolPathInput(input: string): string {
  let path = input.trim().replace(UNICODE_SPACES, " ").normalize("NFC");
  if (path.startsWith("@")) path = path.slice(1);
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return resolve(homedir(), path.slice(2));
  }
  return path;
}

export function resolveToCwd(cwd: string, input: string): string {
  const expanded = expandToolPathInput(input);
  return resolveNativePath(cwd, expanded);
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

export function notDirectoryMessage(
  input: unknown,
  resolvedPath: string,
  isFile: boolean,
): string {
  const label = typeof input === "string" ? input.trim() : resolvedPath;
  return isFile
    ? `not a directory: ${label} is a file. Use read.`
    : `not a directory: ${label}`;
}

const LISTING_CAP = 30;

/**
 * One-line "path not found" reason. With `withListing`, adds the entries of the nearest
 * existing ancestor directory so the model can correct the path (read/grep/ls/find only).
 */
export async function pathNotFoundMessage(
  input: unknown,
  resolvedPath: string,
  withListing = false,
): Promise<string> {
  const label = typeof input === "string" ? input.trim() : resolvedPath;
  const head = `path not found: ${label}`;
  if (!withListing) return head;
  try {
    const listing = await nearestDirectoryListing(label, resolvedPath);
    return listing ? `${head}\n${listing}` : head;
  } catch {
    return head;
  }
}

async function nearestDirectoryListing(
  label: string,
  resolvedPath: string,
): Promise<string | undefined> {
  let dir = resolvedPath;
  let missing = basename(dir);
  let climbed = 0;
  for (;;) {
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    missing = basename(dir);
    dir = parent;
    climbed += 1;
    const info = await stat(dir).catch(() => undefined);
    if (info?.isDirectory()) break;
  }
  const entries = await readdir(dir, { withFileTypes: true });
  const names = entries.map((e) => `${e.name}${e.isDirectory() ? "/" : ""}`);
  const shared = (name: string) => {
    let n = 0;
    while (n < name.length && n < missing.length && name[n] === missing[n]) n++;
    return n;
  };
  names.sort((a, b) => shared(b) - shared(a) || a.localeCompare(b));
  const shown = names.slice(0, LISTING_CAP);
  const more =
    names.length > shown.length ? ` … ${names.length - shown.length} more` : "";
  return `Nearest existing directory ${displayAncestor(label, dir, climbed)} contains: ${shown.join(" ") || "(empty)"}${more}`;
}

/** The ancestor spelled the way the model spelled the path (relative stays relative). */
function displayAncestor(label: string, dir: string, climbed: number): string {
  let path = label.startsWith("@") ? label.slice(1) : label;
  while (path.endsWith("/") || path.endsWith("\\")) path = path.slice(0, -1);
  // Cut the path as the model wrote it, so its separators (`/` or `\`) stay unchanged.
  const separators = [...path.matchAll(/[\\/]/g)].map((match) => match.index);
  if (separators.length >= climbed) {
    const end = separators[separators.length - climbed];
    if (end !== undefined && end > 0) return path.slice(0, end + 1);
  } else if (!isAbsolute(path) && !path.startsWith("~")) {
    return "./";
  }
  return /[\\/]$/.test(dir) ? dir : `${dir}${sep}`;
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
