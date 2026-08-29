import path from "node:path";

export function isPathInDirectoryTree(
  root: string,
  candidate: string,
): boolean {
  const flavor = /^[A-Za-z]:[\\/]/.test(root) ? path.win32 : path;
  const relative = flavor.relative(
    flavor.resolve(root),
    flavor.resolve(candidate),
  );
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${flavor.sep}`) &&
      !flavor.isAbsolute(relative))
  );
}
