import { CliError } from "./main.ts";

export interface FocusedOptions {
  base: string;
  dryRun: boolean;
  /** Stages named with `--only`, when given. */
  only?: string[];
}

/**
 * Parse the standard focused-operation flags: `--base <revision>` and `--dry-run`
 * (plus `--only <stage[,stage]>` where `onlyStages` lists the accepted stage names).
 * Duplicate flags, unknown flags and a missing/flag-like value throw a usage
 * error. Declared as data so new entry points share one contract.
 */
export function parseFocusedArguments(
  args: readonly string[],
  usage: string,
  { onlyStages }: { onlyStages?: readonly string[] } = {},
): FocusedOptions {
  const options: FocusedOptions = { base: "origin/main", dryRun: false };
  const seen = new Set<string>();
  const value = (index: number): string | undefined => {
    const next = args[index + 1];
    return next?.trim() && !next.startsWith("-") ? next : undefined;
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (seen.has(arg)) throw new CliError(usage);
    seen.add(arg);
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--base" && value(index) !== undefined)
      options.base = args[++index]!;
    else if (arg === "--only" && onlyStages && value(index) !== undefined) {
      const stages = args[++index]!.split(",");
      if (stages.some((stage) => !onlyStages.includes(stage)))
        throw new CliError(`${usage}\nStages: ${onlyStages.join(", ")}`);
      options.only = stages;
    } else throw new CliError(usage);
  }
  return options;
}

export interface FlagSpec {
  type: "boolean" | "string";
  description: string;
  default?: boolean | string;
}

export type ParsedFlags<T extends Record<string, FlagSpec>> = {
  [K in keyof T]: T[K]["type"] extends "boolean" ? boolean : string | undefined;
};

/**
 * Declared-flag parser for entry points that need more than the focused
 * contract. Unknown, duplicate and valueless flags fail with the usage text
 * (generated from the declaration), which `--help` also prints.
 */
export function parseCli<T extends Record<string, FlagSpec>>(
  name: string,
  flags: T,
  argv: readonly string[],
): ParsedFlags<T> & { help: boolean } {
  const usage = [
    `Usage: ${name} [options]`,
    ...Object.entries(flags).map(
      ([flag, spec]) =>
        `  --${flag}${spec.type === "string" ? " <value>" : ""}  ${spec.description}`,
    ),
  ].join("\n");
  const result: Record<string, boolean | string | undefined> = {};
  for (const [flag, spec] of Object.entries(flags))
    result[flag] =
      spec.default ?? (spec.type === "boolean" ? false : undefined);
  result.help = false;
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") {
      result.help = true;
      continue;
    }
    const flag = arg.startsWith("--") ? arg.slice(2) : undefined;
    const spec = flag === undefined ? undefined : flags[flag];
    if (flag === undefined || !spec || seen.has(flag))
      throw new CliError(`Unknown or repeated argument: ${arg}\n${usage}`);
    seen.add(flag);
    if (spec.type === "boolean") result[flag] = true;
    else {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--"))
        throw new CliError(`Missing value for ${arg}\n${usage}`);
      result[flag] = value;
    }
  }
  if (result.help) throw new CliError(usage, { exitCode: 0 });
  return result as ParsedFlags<T> & { help: boolean };
}
