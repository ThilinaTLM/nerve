import { spawn } from "node:child_process";
import { resolveBashShellConfig } from "@nervekit/tools";
import type { SpawnProcessOptions } from "./types.js";

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
