/**
 * Shorten an absolute filesystem path for compact display.
 *
 * - Collapses the home directory to `~`.
 * - Abbreviates intermediate segments to their first character.
 * - Keeps the final segment (the leaf) in full.
 *
 * e.g. `/home/tlm/Projects/90events` with home `/home/tlm` → `~/P/90events`
 */
export function shortenPath(dir?: string, home?: string): string {
  if (!dir) return "";

  let rest = dir.replace(/\/+$/, "");
  let prefix = "";

  const normalizedHome = home?.replace(/\/+$/, "");
  if (
    normalizedHome &&
    (rest === normalizedHome || rest.startsWith(`${normalizedHome}/`))
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

/**
 * Collapse a leading home directory to `~` while keeping every path segment
 * intact (unlike {@link shortenPath}, which abbreviates intermediate segments).
 *
 * e.g. `/home/tlm/Projects/nerve` with home `/home/tlm` → `~/Projects/nerve`
 */
export function tildePath(dir?: string, home?: string): string {
  if (!dir) return "";

  const rest = dir.replace(/\/+$/, "");
  const normalizedHome = home?.replace(/\/+$/, "");

  if (normalizedHome && rest === normalizedHome) return "~";
  if (normalizedHome && rest.startsWith(`${normalizedHome}/`)) {
    return `~${rest.slice(normalizedHome.length)}`;
  }
  return rest || dir || "/";
}
