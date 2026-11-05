import { spawnSync, type SpawnSyncReturns } from "node:child_process";
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
