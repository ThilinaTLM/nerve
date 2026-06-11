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
