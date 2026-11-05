import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** An expected failure: print the message only (no stack) and exit with `exitCode`. */
export class CliError extends Error {
  constructor(message, { exitCode = 1, cause } = {}) {
    super(message, { cause });
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

/** True when `metaUrl` is the module executed directly by node/tsx. */
export function isEntrypoint(metaUrl) {
  return (
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(metaUrl)
  );
}

/**
 * Run `body`, reporting any failure as its message and setting the exit code
 * instead of throwing, so output and codes are uniform across entry points.
 */
export async function runCli(
  body,
  {
    error = console.error,
    setExitCode = (code) => {
      process.exitCode = code;
    },
  } = {},
) {
  try {
    await body();
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause));
    setExitCode(cause instanceof CliError ? cause.exitCode : 1);
  }
}
