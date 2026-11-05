import { realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  sep,
  win32,
} from "node:path";
import { parseProjectRelativePath } from "@nervekit/contracts/paths";

export function parseProjectEntryTarget(input: unknown): {
  projectId: string;
  segments: readonly string[];
} {
  if (!input || typeof input !== "object")
    throw new Error("Project entry target is required.");
  const { projectId, relativePath } = input as Record<string, unknown>;
  if (typeof projectId !== "string" || typeof relativePath !== "string")
    throw new Error("Project entry project id and path must be strings.");
  if (!projectId.trim()) throw new Error("Project entry project is required.");
  const parsed = parseProjectRelativePath(relativePath, { allowEmpty: true });
  if (!parsed.ok)
    throw new Error(`Project entry path is invalid (${parsed.reason}).`);
  return { projectId: projectId.trim(), segments: parsed.segments };
}

/** Lexically joins validated segments onto a daemon-provided project root. */
export function resolveProjectEntryPath(
  root: string,
  segments: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string {
  const pathApi = platform === "win32" ? win32 : posix;
  if (!root || !pathApi.isAbsolute(root))
    throw new Error("Project entry root must be absolute.");
  const resolvedRoot = pathApi.resolve(root);
  const target = pathApi.resolve(resolvedRoot, ...segments);
  if (segments.length === 0) return target;
  const fromRoot = pathApi.relative(resolvedRoot, target);
  if (
    !fromRoot ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(fromRoot)
  )
    throw new Error("Project entry path escapes the project root.");
  return target;
}

/**
 * Resolves the entry and verifies, after following symlinks, that it stays
 * inside the real project root. With `followLeaf: false` only the parent is
 * canonicalized so a symlink entry itself can be revealed or trashed.
 */
export async function resolveContainedProjectEntryPath(
  root: string,
  segments: readonly string[],
  options: { followLeaf: boolean },
): Promise<string> {
  const target = resolveProjectEntryPath(root, segments);
  const realRoot = await realpath(root);
  const real = options.followLeaf
    ? await realpath(target)
    : join(await realpath(dirname(target)), basename(target));
  const fromRoot = relative(realRoot, real);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  )
    throw new Error("Project entry path escapes the project root.");
  return real;
}
