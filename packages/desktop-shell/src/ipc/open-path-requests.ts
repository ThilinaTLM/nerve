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

/** Flags (see `parseDesktopOptions`) whose value is a separate argument. */
const VALUE_FLAGS = new Set([
  "--connect",
  "--token",
  "--host",
  "--port",
  "--https-port",
]);

export function directoryPathsFromArgv(
  argv: readonly string[],
  cwd: string,
): string[] {
  const candidates: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (VALUE_FLAGS.has(arg)) index += 1;
    else if (!arg.startsWith("-")) candidates.push(resolve(cwd, arg));
  }
  return filterOpenPaths(candidates, true);
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
