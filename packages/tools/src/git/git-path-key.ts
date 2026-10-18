import { posix, win32 } from "node:path";

/** Coordination identity only: never use this string for filesystem or CLI I/O.
 * Rust Windows canonicalize and Node realpath may spell the same path differently.
 * Case-folding Windows is deliberately conservative (case-sensitive dirs may share
 * an extra lane); POSIX spelling/case and backslash filename characters are retained.
 * Equality is conservative, not a substitute for authorizing the actual I/O paths.
 */
export function gitPathKey(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") {
    if (!posix.isAbsolute(path))
      throw new Error("Git lane requires an absolute repository path");
    const normalized = posix.normalize(path);
    return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  }
  let spelling = path.replace(/\\/g, "/");
  spelling = spelling.replace(/^\/\/\?\/unc\//i, "//");
  spelling = spelling.replace(/^\/\/\?\/([a-z]:\/)/i, "$1");
  if (!win32.isAbsolute(spelling))
    throw new Error("Git lane requires an absolute repository path");
  let key = win32
    .normalize(spelling)
    .replace(/\\/g, "/")
    .toLowerCase()
    .replace(/\/+$/, "");
  if (/^[a-z]:$/.test(key)) key += "/";
  return key;
}
