import type { FilesystemLocations } from "$lib/api";

/**
 * Path rules for the folder browser. Everything here follows the DAEMON's
 * operating system (separator, home, drive roots, casing), never the client's.
 */
export type PathContext = Pick<
  FilesystemLocations,
  "platform" | "separator" | "home" | "caseInsensitive"
>;

/** Windows-only virtual level above the drives. Rendered client-side. */
export const THIS_PC = "";

export type PathCrumb = { label: string; path: string };

const DRIVE_ROOT = /^[A-Za-z]:[\\/]?$/;
const UNC_ROOT = /^\\\\[^\\]+\\[^\\]+\\?$/;

function fold(value: string, ctx: PathContext): string {
  return ctx.caseInsensitive || ctx.platform === "win32"
    ? value.toLowerCase()
    : value;
}

export function isRootPath(path: string, ctx: PathContext): boolean {
  if (ctx.platform === "win32") {
    return DRIVE_ROOT.test(path) || UNC_ROOT.test(path);
  }
  return path === "/";
}

export function joinPath(dir: string, name: string, sep: "/" | "\\"): string {
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/** Drop a trailing separator unless the path is a filesystem root. */
export function trimTrailingSeparator(path: string, ctx: PathContext): string {
  if (path.length <= 1 || isRootPath(path, ctx)) return path;
  return path.replace(/[\\/]+$/, "") || path;
}

/**
 * Parent folder in the daemon's path space. Returns `THIS_PC` above a Windows
 * drive and `undefined` at a POSIX root or the virtual root.
 */
export function parentPath(path: string, ctx: PathContext): string | undefined {
  if (path === THIS_PC) return undefined;
  if (isRootPath(path, ctx))
    return ctx.platform === "win32" ? THIS_PC : undefined;
  const trimmed = trimTrailingSeparator(path, ctx);
  const cut = trimmed.lastIndexOf(ctx.separator);
  if (cut < 0) return undefined;
  const parent = trimmed.slice(0, cut);
  if (ctx.platform === "win32" && /^[A-Za-z]:$/.test(parent)) {
    return `${parent}\\`;
  }
  return parent || ctx.separator;
}

function underHome(path: string, ctx: PathContext): string | undefined {
  const home = trimTrailingSeparator(ctx.home, ctx);
  if (!home) return undefined;
  const a = fold(path, ctx);
  const h = fold(home, ctx);
  if (a === h) return "";
  if (a.startsWith(h + ctx.separator)) return path.slice(home.length);
  return undefined;
}

/** Collapse the home folder to `~`, keeping the daemon's separator. */
export function toDisplayPath(path: string, ctx: PathContext): string {
  if (path === THIS_PC) return "This PC";
  const rest = underHome(path, ctx);
  return rest === undefined ? path : `~${rest}`;
}

/** Expand a leading `~` and normalise separators to the daemon's style. */
export function expandTypedPath(value: string, ctx: PathContext): string {
  let v = value.trim().replace(/^["']|["']$/g, "");
  if (!v) return "";
  if (v === "~" || v.startsWith("~/") || v.startsWith("~\\")) {
    v = trimTrailingSeparator(ctx.home, ctx) + v.slice(1);
  }
  if (ctx.platform === "win32") {
    const unc = v.startsWith("\\\\") || v.startsWith("//");
    v = v.replace(/\//g, "\\");
    if (unc) v = `\\\\${v.replace(/^\\+/, "")}`;
    if (/^[A-Za-z]:$/.test(v)) v = `${v}\\`;
  }
  return v;
}

/** Normalised target for a typed path, ready for the daemon listing. */
export function resolveTypedPath(value: string, ctx: PathContext): string {
  const expanded = expandTypedPath(value, ctx);
  return expanded ? trimTrailingSeparator(expanded, ctx) : "";
}

/**
 * Split a half-typed path into the folder to list and the name prefix to match,
 * e.g. `~/Pro` -> list `/home/me`, prefix `Pro`.
 */
export function completionQuery(
  draft: string,
  ctx: PathContext,
): { dir: string; prefix: string } | undefined {
  const expanded = expandTypedPath(
    draft === "~" ? `~${ctx.separator}` : draft,
    ctx,
  );
  const cut = Math.max(expanded.lastIndexOf("\\"), expanded.lastIndexOf("/"));
  if (cut < 0) return undefined;
  const prefix = expanded.slice(cut + 1);
  const dir = trimTrailingSeparator(expanded.slice(0, cut + 1), ctx);
  if (!dir) return undefined;
  return { dir, prefix };
}

/** Breadcrumb trail; Windows drives sit under the virtual `This PC` crumb. */
export function pathCrumbs(
  path: string,
  ctx: PathContext,
  rootLabel: string = "/",
): PathCrumb[] {
  const crumbs: PathCrumb[] = [];
  let acc: string;
  let rest: string;
  const home = underHome(path, ctx);
  if (path === THIS_PC) return [{ label: "This PC", path: THIS_PC }];
  if (home !== undefined) {
    acc = trimTrailingSeparator(ctx.home, ctx);
    crumbs.push({ label: "~", path: acc });
    rest = home;
  } else if (ctx.platform === "win32") {
    const unc = path.match(/^(\\\\[^\\]+\\[^\\]+)/);
    if (unc?.[1]) {
      acc = unc[1];
      crumbs.push({ label: acc, path: acc });
      rest = path.slice(acc.length);
    } else {
      crumbs.push({ label: "This PC", path: THIS_PC });
      const drive = path.slice(0, 2);
      acc = `${drive}\\`;
      crumbs.push({ label: drive, path: acc });
      rest = path.slice(3);
    }
  } else {
    acc = "/";
    crumbs.push({ label: rootLabel, path: "/" });
    rest = path;
  }
  for (const part of rest.split(ctx.separator).filter(Boolean)) {
    acc = joinPath(acc, part, ctx.separator);
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

/** Distinct parent folders of known projects, most used first. */
export function projectRoots(
  directories: readonly string[],
  ctx: PathContext,
  limit = 6,
): string[] {
  const counts = new Map<string, { path: string; count: number }>();
  for (const directory of directories) {
    const parent = parentPath(directory, ctx);
    if (!parent) continue;
    const key = fold(parent, ctx);
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { path: parent, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((entry) => entry.path);
}
