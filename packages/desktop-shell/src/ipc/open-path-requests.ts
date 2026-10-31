import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/** OS open-file events may contain files; the renderer decides what to open. */
export function filterOpenPaths(
  paths: readonly string[],
  directoriesOnly = false,
): string[] {
  return paths.filter((path) => {
    if (!isAbsolute(path)) return false;
    try {
      const stat = statSync(path);
      return stat.isDirectory() || (!directoriesOnly && stat.isFile());
    } catch {
      return false;
    }
  });
}

export function directoryPathsFromArgv(
  argv: readonly string[],
  cwd: string,
): string[] {
  return filterOpenPaths(
    argv
      .filter((arg) => arg.length > 0 && !arg.startsWith("-"))
      .map((arg) => resolve(cwd, arg)),
    true,
  );
}

/** Single-window queue: requests survive startup and renderer reloads. */
export class OpenPathRequests {
  private pending: string[][] = [];
  private listener: ((paths: string[]) => void) | undefined;

  enqueue(paths: string[]): void {
    if (paths.length === 0) return;
    if (this.listener) this.listener([...paths]);
    else this.pending.push([...paths]);
  }

  subscribe(listener: (paths: string[]) => void): () => void {
    this.listener = listener;
    const pending = this.pending;
    this.pending = [];
    for (const paths of pending) listener(paths);
    return () => {
      if (this.listener === listener) this.listener = undefined;
    };
  }
}

export const openPathRequests = new OpenPathRequests();
