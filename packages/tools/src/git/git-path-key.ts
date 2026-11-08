import { posix, win32 } from "node:path";

/** A single backwards scan avoids suffix-regex backtracking on path input. */
function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === 47) end--;
  return path.slice(0, end);
}

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
    return normalized.length > 1 ? trimTrailingSlashes(normalized) : normalized;
  }
  let spelling = path.replace(/\\/g, "/");
  spelling = spelling.replace(/^\/\/\?\/unc\//i, "//");
  spelling = spelling.replace(/^\/\/\?\/([a-z]:\/)/i, "$1");
  if (!win32.isAbsolute(spelling))
    throw new Error("Git lane requires an absolute repository path");
  let key = trimTrailingSlashes(
    win32.normalize(spelling).replace(/\\/g, "/").toLowerCase(),
  );
  if (/^[a-z]:$/.test(key)) key += "/";
  return key;
}

/**
 * `child` relative to `parent` as `/`-separated segments, or undefined when it
 * is not strictly inside. Containment is decided on path keys, because Rust
 * (`\\?\D:\...`) and Node (`D:\...`) spell the same Windows path differently;
 * the segments keep the child's own spelling.
 */
export function relativePathInside(
  parent: string,
  child: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const rel = posix.relative(
    gitPathKey(parent, platform),
    gitPathKey(child, platform),
  );
  if (!rel || rel === ".." || rel.startsWith("../") || posix.isAbsolute(rel))
    return undefined;
  const count = rel.split("/").length;
  const separators = platform === "win32" ? /[\\/]+/ : /\/+/;
  return child.split(separators).filter(Boolean).slice(-count).join("/");
}
