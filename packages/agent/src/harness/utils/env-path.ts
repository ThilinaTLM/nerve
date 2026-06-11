const WINDOWS_DRIVE_PATH_RE = /^[A-Za-z]:[\\/]/;
const WINDOWS_DRIVE_ROOT_RE = /^[A-Za-z]:[\\/]+$/;

function preferredSeparator(path: string): "/" | "\\" {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

function stripTrailingSeparators(path: string): string {
  if (WINDOWS_DRIVE_ROOT_RE.test(path)) return path.slice(0, 3);
  return path.replace(/[\\/]+$/, "") || path;
}

function toPosixPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:\/+$/u.test(normalized)) return normalized.slice(0, 3);
  return normalized.replace(/\/+$/, "") || normalized;
}

function isWindowsDrivePath(path: string): boolean {
  return WINDOWS_DRIVE_PATH_RE.test(path) || /^[A-Za-z]:\//u.test(path);
}

function makeRelativeIgnorePath(path: string): string {
  return path.replace(/^[A-Za-z]:\/?/u, "").replace(/^\/+/, "");
}

/** Join environment paths while preserving Windows-style separators when the base path uses them. */
export function joinEnvPath(base: string, child: string): string {
  const separator = preferredSeparator(base);
  const normalizedBase = stripTrailingSeparators(base);
  const normalizedChild = child.replace(/^[\\/]+/, "");
  if (!normalizedBase) return normalizedChild;
  const separatorPrefix = /[\\/]$/.test(normalizedBase) ? "" : separator;
  return `${normalizedBase}${separatorPrefix}${normalizedChild}`;
}

/** Return the parent directory for either POSIX or Windows-style environment paths. */
export function dirnameEnvPath(path: string): string {
  const normalized = stripTrailingSeparators(path);
  const slashIndex = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  if (slashIndex === -1) return ".";
  if (slashIndex === 0) return normalized.slice(0, 1);
  if (slashIndex === 2 && WINDOWS_DRIVE_PATH_RE.test(normalized)) {
    return normalized.slice(0, 3);
  }
  return normalized.slice(0, slashIndex);
}

/** Return the final path segment for either POSIX or Windows-style environment paths. */
export function basenameEnvPath(path: string): string {
  const normalized = stripTrailingSeparators(path);
  const slashIndex = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  return slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
}

/**
 * Return a POSIX-style path relative to root for ignore matching.
 *
 * The ignore package requires relative, slash-separated paths. Execution environments may return native Windows paths,
 * so comparisons are performed on normalized separators before the relative path is produced.
 */
export function relativeEnvPath(root: string, path: string): string {
  const normalizedRoot = toPosixPath(root);
  const normalizedPath = toPosixPath(path);
  const windowsComparison =
    isWindowsDrivePath(normalizedRoot) || isWindowsDrivePath(normalizedPath);
  const compareRoot = windowsComparison
    ? normalizedRoot.toLowerCase()
    : normalizedRoot;
  const comparePath = windowsComparison
    ? normalizedPath.toLowerCase()
    : normalizedPath;

  if (comparePath === compareRoot) return "";
  if (comparePath.startsWith(`${compareRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return makeRelativeIgnorePath(normalizedPath);
}
