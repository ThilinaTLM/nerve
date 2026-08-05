import { posix, win32 } from "node:path";

export type DesktopProjectEntryTarget = {
  root: string;
  relativePath: string;
};

export function resolveProjectEntryPath(
  input: unknown,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!input || typeof input !== "object")
    throw new Error("Project entry target is required.");
  const { root, relativePath } = input as Record<string, unknown>;
  if (typeof root !== "string" || typeof relativePath !== "string")
    throw new Error("Project entry root and relative path must be strings.");

  const pathApi = platform === "win32" ? win32 : posix;
  const normalizedRoot = root.trim();
  const normalizedRelative = relativePath.trim().replaceAll("\\", "/");
  if (!normalizedRoot || !pathApi.isAbsolute(normalizedRoot))
    throw new Error("Project entry root must be absolute.");
  if (
    !normalizedRelative ||
    normalizedRelative.includes("\0") ||
    normalizedRelative.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalizedRelative)
  )
    throw new Error("Project entry path must be relative.");
  const segments = normalizedRelative.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  )
    throw new Error("Project entry path contains an invalid segment.");

  const resolvedRoot = pathApi.resolve(normalizedRoot);
  const target = pathApi.resolve(resolvedRoot, ...segments);
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
