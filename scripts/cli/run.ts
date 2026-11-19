import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { win32 } from "node:path";
import { CliError } from "./main.ts";
import { section } from "./log.ts";

/** One subprocess to run: what, where and why (the reason is printed before it runs). */
export interface Step {
  command: string;
  args: string[];
  reason: string;
  cwd?: string;
}

/** Injection point for tests; production uses `child_process.spawnSync`. */
export type SpawnFunction = (
  command: string,
  args: string[],
  options: { cwd?: string; stdio: "inherit"; shell?: boolean },
) => Partial<SpawnSyncReturns<unknown>>;

/**
 * How to launch pnpm without a shell where possible: through its JS entrypoint
 * under Node when known, else the `pnpm` binary. On Windows that binary is a
 * `.cmd` script, so only then is a shell used (arguments must be fixed, never
 * user paths; those need the JS entrypoint).
 */
export function pnpmInvocation(
  args: string[],
  pnpmPath: string | undefined = process.env.npm_execpath,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; shell: boolean } {
  if (/(?:^|[/\\])pnpm\.(?:c?js|mjs)$/i.test(pnpmPath ?? ""))
    return {
      command: process.execPath,
      args: [pnpmPath!, ...args],
      shell: false,
    };
  return { command: "pnpm", args, shell: platform === "win32" };
}

/**
 * `npm` is a `.cmd` script on Windows and cannot be spawned without a shell,
 * which would mangle paths with spaces. Run npm's JS entrypoint (bundled next
 * to node) instead; other commands and platforms are unchanged.
 */
export function directInvocation(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
): { command: string; args: string[] } {
  if (platform !== "win32" || command !== "npm") return { command, args };
  return {
    command: execPath,
    args: [
      win32.join(
        win32.dirname(execPath),
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js",
      ),
      ...args,
    ],
  };
}

export interface RunOptions {
  cwd?: string;
  spawn?: SpawnFunction;
  shell?: boolean;
  /** Customize the failure message for a non-zero exit. */
  failure?: (result: Partial<SpawnSyncReturns<unknown>>) => string;
}

/**
 * Run one command with inherited stdio and throw a CliError on spawn error or
 * non-zero status.
 */
export function runStep(
  command: string,
  args: string[],
  {
    cwd,
    spawn = spawnSync as SpawnFunction,
    shell,
    failure = (result) =>
      `${command} failed (${result.signal ?? result.status})`,
  }: RunOptions = {},
): void {
  const result = spawn(command, args, {
    cwd,
    stdio: "inherit",
    ...(shell === undefined ? {} : { shell }),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new CliError(failure(result));
}

/** Run `steps` in order, announcing each reason; stops at the first failure. A dry run runs nothing. */
export function runSteps(
  steps: readonly Step[],
  {
    dryRun = false,
    log = console.log,
    ...options
  }: RunOptions & { dryRun?: boolean; log?: (line: string) => void } = {},
): void {
  if (dryRun) return;
  for (const step of steps) {
    section(step.reason, log);
    runStep(step.command, step.args, {
      ...options,
      cwd: step.cwd ?? options.cwd,
    });
  }
}
