import path from "node:path";
import type { TaskRecord } from "@nervekit/contracts";
import { isActiveTaskStatus } from "./task-status.js";

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

export function activeBackgroundTaskIdsInDirectoryTree(
  tasks: readonly TaskRecord[],
  root: string,
): string[] {
  return tasks
    .filter(
      (task) =>
        task.visibility !== "foreground" &&
        isActiveTaskStatus(task.status) &&
        isPathInDirectoryTree(root, task.cwd),
    )
    .map((task) => task.id);
}
