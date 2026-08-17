import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import { MigrationError } from "./migration.js";

export function assertCanonicalRelativePath(path: string): string {
  if (
    !path ||
    posix.isAbsolute(path) ||
    path.includes("\\") ||
    posix.normalize(path) !== path ||
    path
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new MigrationError(`Unsafe migration backup path '${path}'.`);
  }
  return path;
}

export function joinCanonicalPath(...parts: string[]): string {
  return assertCanonicalRelativePath(posix.join(...parts));
}

export function resolveCanonicalPath(root: string, path: string): string {
  assertCanonicalRelativePath(path);
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, path);
  const pathFromRoot = relative(resolvedRoot, target);
  if (
    pathFromRoot === "" ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new MigrationError(`Unsafe migration backup path '${path}'.`);
  }
  return target;
}
