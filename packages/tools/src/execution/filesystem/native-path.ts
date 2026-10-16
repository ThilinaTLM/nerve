import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve external path syntax into a native filesystem path, not a shell argument. */
export function resolveNativePath(
  root: string,
  input: string,
  platform: NodeJS.Platform = process.platform,
): string {
  let path = input.trim();
  if (/^file:\/\//i.test(path)) {
    try {
      path = fileURLToPath(new URL(path), { windows: platform === "win32" });
    } catch {
      // Malformed URLs remain ordinary paths for the caller's validation/stat.
    }
  }
  if (platform === "win32") {
    const drive = path.match(/^\/(?:mnt\/)?([A-Za-z])(?:\/|$)(.*)$/);
    if (drive) path = `${drive[1].toUpperCase()}:/${drive[2] ?? ""}`;
  }
  const paths = platform === "win32" ? win32 : posix;
  return paths.resolve(root, path);
}

/** Lexical containment only. Canonicalize with realpath first when following symlinks. */
export function isPathInside(
  root: string,
  target: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const paths = platform === "win32" ? win32 : posix;
  const relative = paths.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${paths.sep}`) &&
    !paths.isAbsolute(relative)
  );
}
