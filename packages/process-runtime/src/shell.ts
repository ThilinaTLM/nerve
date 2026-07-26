import { type ChildProcess, spawn } from "node:child_process";
import { resolveBashShellConfig } from "@nervekit/tools";
import type { ProcessLifecycleResult, SpawnProcessOptions } from "./types.js";

export function processEnvironment(
  overrides?: Record<string, string>,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PAGER: "cat",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    TERM: "dumb",
    CI: process.env.CI ?? "1",
    ...(overrides ?? {}),
  };
}

export function observeProcessLifecycle(child: ChildProcess): {
  exited: Promise<ProcessLifecycleResult>;
  closed: Promise<ProcessLifecycleResult>;
} {
  let resolveExited!: (result: ProcessLifecycleResult) => void;
  let resolveClosed!: (result: ProcessLifecycleResult) => void;
  let exitedSettled = false;
  let closedSettled = false;
  const exited = new Promise<ProcessLifecycleResult>(
    (resolve) => (resolveExited = resolve),
  );
  const closed = new Promise<ProcessLifecycleResult>(
    (resolve) => (resolveClosed = resolve),
  );
  const finishExited = (result: ProcessLifecycleResult) => {
    if (exitedSettled) return;
    exitedSettled = true;
    resolveExited(result);
  };
  const finishClosed = (result: ProcessLifecycleResult) => {
    if (closedSettled) return;
    closedSettled = true;
    resolveClosed(result);
  };
  child.once("error", (error) => {
    const result: ProcessLifecycleResult = {
      kind: "error",
      error: error instanceof Error ? error : new Error(String(error)),
    };
    finishExited(result);
    finishClosed(result);
  });
  child.once("exit", (exitCode, signal) =>
    finishExited({ kind: "closed", exitCode, signal }),
  );
  child.once("close", (exitCode, signal) => {
    const result: ProcessLifecycleResult = {
      kind: "closed",
      exitCode,
      signal,
    };
    finishExited(result);
    finishClosed(result);
  });
  return { exited, closed };
}

export function spawnShell(command: string, options: SpawnProcessOptions) {
  const shell = resolveBashShellConfig({ shellPath: options.shellPath });
  return spawn(shell.shell, [...shell.args, command], {
    cwd: options.cwd,
    env: processEnvironment(options.env),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
}
