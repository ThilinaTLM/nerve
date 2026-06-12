const WINDOWS_DRIVE_ROOT = /^[A-Za-z]:[\\/]/;
const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:$/;

function isWindowsLikePath(path: string): boolean {
  return (
    WINDOWS_DRIVE_ROOT.test(path) ||
    path.startsWith("\\\\") ||
    path.startsWith("//")
  );
}

function preferredSeparator(base: string): "/" | "\\" {
  return isWindowsLikePath(base) && base.includes("\\") ? "\\" : "/";
}

function trimTrailingSeparators(path: string): string {
  if (WINDOWS_DRIVE_PREFIX.test(path)) return path;
  return path.replace(/[\\/]+$/g, "");
}

export function isAbsoluteLocalPath(path: string): boolean {
  const value = path.trim();
  return (
    value.startsWith("/") ||
    WINDOWS_DRIVE_ROOT.test(value) ||
    value.startsWith("\\\\")
  );
}

export function normalizePathForCompare(path: string): string {
  let value = path.trim().replace(/\\/g, "/");
  const unc = value.startsWith("//");
  value = value.replace(/\/{2,}/g, "/");
  if (unc && !value.startsWith("//")) value = `/${value}`;
  value = value.replace(/\/+$/g, "");
  if (/^[A-Za-z]:($|\/)/.test(value)) {
    value = `${value[0]?.toLowerCase()}${value.slice(1)}`;
  }
  return value;
}

export function joinLocalPath(base: string, child: string): string {
  const cleanChild = child.trim();
  if (isAbsoluteLocalPath(cleanChild)) return cleanChild;

  const sep = preferredSeparator(base);
  const normalizedChild = cleanChild.replace(/[\\/]+/g, sep);
  const trimmedBase = trimTrailingSeparators(base.trim());
  if (!trimmedBase || trimmedBase === ".") return normalizedChild;
  return `${trimmedBase}${sep}${normalizedChild.replace(/^[\\/]+/, "")}`;
}

export function relativePathForDisplay(
  path: string | undefined,
  cwd: string,
): string | undefined {
  if (!path) return undefined;
  const normalizedPath = normalizePathForCompare(path);
  const normalizedCwd = normalizePathForCompare(cwd);
  if (normalizedPath === normalizedCwd) return ".";
  const prefix = normalizedCwd.endsWith("/")
    ? normalizedCwd
    : `${normalizedCwd}/`;
  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }
  return path.replace(/\\/g, "/");
}

export function resolveDisplayPath(
  path: string | undefined,
  cwd: string,
): string | undefined {
  if (!path) return undefined;
  const clean = path.trim();
  if (!clean) return undefined;
  if (isAbsoluteLocalPath(clean)) return clean;
  return joinLocalPath(cwd, clean);
}

function decodePathComponent(path: string): string | undefined {
  try {
    return decodeURIComponent(path);
  } catch {
    return undefined;
  }
}

export function parseLocalFileHref(href: string): string | undefined {
  const value = href.trim();
  if (!value) return undefined;

  const lower = value.toLowerCase();
  if (
    lower.startsWith("http:") ||
    lower.startsWith("https:") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("data:") ||
    lower.startsWith("javascript:") ||
    lower.startsWith("#")
  ) {
    return undefined;
  }

  if (lower.startsWith("file://")) {
    try {
      const url = new URL(value);
      const decoded = decodePathComponent(url.pathname);
      if (!decoded) return undefined;
      if (url.hostname) return `//${url.hostname}${decoded}`;
      return decoded.replace(/^\/([A-Za-z]:\/)/, "$1");
    } catch {
      return undefined;
    }
  }

  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) &&
    !WINDOWS_DRIVE_ROOT.test(value)
  ) {
    return undefined;
  }

  return decodePathComponent(value.split(/[?#]/, 1)[0] ?? "");
}

export function splitPathLineSuffix(path: string): {
  path: string;
  line?: number;
} {
  const index = path.lastIndexOf(":");
  if (index <= 0) return { path };
  if (index === 1 && /^[A-Za-z]$/.test(path[0] ?? "")) return { path };
  const suffix = path.slice(index + 1);
  if (!/^\d+$/.test(suffix)) return { path };
  const line = Number(suffix);
  if (!Number.isSafeInteger(line) || line <= 0) return { path };
  return { path: path.slice(0, index), line };
}
