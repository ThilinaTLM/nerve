import { CliError } from "./main.mjs";

/**
 * Parse the standard focused-operation flags: `--base <revision>` and `--dry-run`.
 * Duplicate flags, unknown flags and a missing/flag-like `--base` value throw a
 * usage error. Declared as data so new entry points share one contract.
 */
export function parseFocusedArguments(args, usage) {
  const options = { base: "origin/main", dryRun: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (seen.has(arg)) throw new CliError(usage);
    seen.add(arg);
    if (arg === "--dry-run") options.dryRun = true;
    else if (
      arg === "--base" &&
      args[index + 1]?.trim() &&
      !args[index + 1].startsWith("-")
    )
      options.base = args[++index];
    else throw new CliError(usage);
  }
  return options;
}
