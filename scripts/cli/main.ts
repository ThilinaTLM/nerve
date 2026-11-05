import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** An expected failure: print the message only (no stack) and exit with `exitCode`. */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(
    message: string,
    { exitCode = 1, cause }: { exitCode?: number; cause?: unknown } = {},
  ) {
    super(message, { cause });
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

/** True when `metaUrl` is the module executed directly by node/tsx. */
export function isEntrypoint(metaUrl: string): boolean {
  return (
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(metaUrl)
  );
}

export interface CliHooks {
  error?: (message: string) => void;
  setExitCode?: (code: number) => void;
}

/**
 * Run `body`, reporting any failure as its message and setting the exit code
 * instead of throwing, so output and codes are uniform across entry points.
 */
export async function runCli(
  body: () => Promise<void> | void,
  {
    error = console.error,
    setExitCode = (code) => {
      process.exitCode = code;
    },
  }: CliHooks = {},
): Promise<void> {
  try {
    await body();
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause));
    setExitCode(cause instanceof CliError ? cause.exitCode : 1);
  }
}

/**
 * Declare an entry point: runs `body(argv)` through {@link runCli} only when the
 * module is executed directly, so the module stays importable by tests.
 */
export function defineCli(
  metaUrl: string,
  body: (argv: string[]) => Promise<void> | void,
): Promise<void> | undefined {
  if (!isEntrypoint(metaUrl)) return undefined;
  return runCli(() => body(process.argv.slice(2)));
}
