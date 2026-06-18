/**
 * Shorten an absolute filesystem path for compact display.
 *
 * - Collapses the home directory to `~`.
 * - Abbreviates intermediate segments to their first character.
 * - Keeps the final segment (the leaf) in full.
 *
 * e.g. `/home/user/Projects/example-app` with home `/home/user` → `~/P/example-app`
 */
export function shortenPath(dir?: string, home?: string): string {
  if (!dir) return "";

  let rest = normalizeDisplayPath(dir);
  let prefix = "";

  const normalizedHome = home ? normalizeDisplayPath(home) : undefined;
  if (
    normalizedHome &&
    (pathsEqual(rest, normalizedHome) || pathStartsWith(rest, normalizedHome))
  ) {
    rest = rest.slice(normalizedHome.length);
    prefix = "~";
  } else if (rest.startsWith("/")) {
    prefix = "";
  }

  const segments = rest.split("/").filter(Boolean);
  if (segments.length === 0) return prefix || rest || "/";

  const leaf = segments[segments.length - 1];
  const parents = segments.slice(0, -1).map((segment) => {
    const [first] = Array.from(segment);
    return first ?? "";
  });

  const head = prefix ? [prefix, ...parents] : parents;
  return [...head, leaf].join("/");
}

function normalizeDisplayPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "") || path;
}

function comparablePath(path: string): string {
  const normalized = normalizeDisplayPath(path);
  return /^[A-Za-z]:\//.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
}

function pathsEqual(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

function pathStartsWith(candidate: string, root: string): boolean {
  return comparablePath(candidate).startsWith(`${comparablePath(root)}/`);
}

/**
 * Return true when `candidate` is exactly `root` or is inside `root`.
 * This deliberately avoids sibling-prefix matches such as `/repo-app` for `/repo`.
 */
export function isPathInDirectory(candidate?: string, root?: string): boolean {
  if (!candidate || !root) return false;
  const normalizedCandidate = normalizeDisplayPath(candidate);
  const normalizedRoot = normalizeDisplayPath(root);
  return (
    pathsEqual(normalizedCandidate, normalizedRoot) ||
    pathStartsWith(normalizedCandidate, normalizedRoot)
  );
}

/**
 * Collapse a leading home directory to `~` while keeping every path segment
 * intact (unlike {@link shortenPath}, which abbreviates intermediate segments).
 *
 * e.g. `/home/user/Projects/nerve` with home `/home/user` → `~/Projects/nerve`
 */
export function tildePath(dir?: string, home?: string): string {
  if (!dir) return "";

  const rest = normalizeDisplayPath(dir);
  const normalizedHome = home ? normalizeDisplayPath(home) : undefined;

  if (normalizedHome && pathsEqual(rest, normalizedHome)) return "~";
  if (normalizedHome && pathStartsWith(rest, normalizedHome)) {
    return `~${rest.slice(normalizedHome.length)}`;
  }
  return rest || dir || "/";
}

/**
 * Stable, case-correct key for a filesystem path. Drive-letter (Windows) paths
 * are lower-cased for case-insensitive matching; POSIX paths stay case-sensitive.
 */
export function pathKey(path: string): string {
  return comparablePath(path);
}

/** True when two paths refer to the same location (platform-aware casing). */
export function samePath(a: string, b: string): boolean {
  return comparablePath(a) === comparablePath(b);
}

/**
 * Heuristic: does this user-typed value look like a filesystem path (to be
 * navigated) rather than a fuzzy filter term? Recognizes POSIX, `~`, Windows
 * drive (`C:\`, `C:/`), UNC (`\\server`), and `file://` inputs.
 */
export function looksLikePath(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return (
    v.startsWith("/") ||
    v.startsWith("~") ||
    v.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]?/.test(v) ||
    v.includes("/") ||
    v.includes("\\") ||
    v.toLowerCase().startsWith("file://")
  );
}

export type PathCrumb = { label: string; path: string };

function detectSeparator(path: string): "/" | "\\" {
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")) {
    return path.includes("\\") ? "\\" : "/";
  }
  return "/";
}

function joinWithSeparator(
  base: string,
  part: string,
  sep: "/" | "\\",
): string {
  return base.endsWith(sep) ? `${base}${part}` : `${base}${sep}${part}`;
}

function pathRoot(
  raw: string,
  sep: "/" | "\\",
): { label: string; path: string } | undefined {
  const drive = raw.match(/^([A-Za-z]:)[\\/]/);
  if (drive) {
    const letter = drive[1] ?? "";
    return { label: letter, path: `${letter}${sep}` };
  }
  const unc = raw.match(/^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/);
  if (unc) {
    const root = `${sep}${sep}${unc[1]}${sep}${unc[2]}`;
    return { label: root, path: root };
  }
  if (raw.startsWith("/")) return { label: "/", path: "/" };
  return undefined;
}

/**
 * Build clickable breadcrumbs for a native directory path, preserving the
 * platform separator so each crumb's `path` remains a valid native target.
 * Collapses a leading home directory to a `~` crumb. Works for POSIX, Windows
 * drive, and UNC paths.
 */
export function pathBreadcrumbs(path?: string, home?: string): PathCrumb[] {
  if (!path) return [];
  const raw = path.trim();
  if (!raw) return [];

  const sep = detectSeparator(raw);
  const normRaw = normalizeDisplayPath(raw);
  const crumbs: PathCrumb[] = [];
  let base: string;
  let rest: string;

  const normalizedHome = home ? normalizeDisplayPath(home) : undefined;
  if (
    normalizedHome &&
    (pathsEqual(normRaw, normalizedHome) ||
      pathStartsWith(normRaw, normalizedHome))
  ) {
    base = home?.replace(/[\\/]+$/, "") || (home ?? "~");
    crumbs.push({ label: "~", path: base });
    rest = normRaw.slice(normalizedHome.length);
  } else {
    const root = pathRoot(raw, sep);
    if (root) {
      base = root.path;
      crumbs.push({ label: root.label, path: root.path });
      rest = normRaw.slice(normalizeDisplayPath(root.path).length);
    } else {
      base = "";
      rest = normRaw;
    }
  }

  for (const part of rest.split("/").filter(Boolean)) {
    base = base ? joinWithSeparator(base, part, sep) : part;
    crumbs.push({ label: part, path: base });
  }
  return crumbs;
}
