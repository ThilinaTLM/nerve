import { spawn as spawnAsync, spawnSync } from "node:child_process";
import { parseFocusedArguments, type FocusedOptions } from "../cli/args.ts";
import { formatCommand, section } from "../cli/log.ts";
import { runCli, CliError, type CliHooks } from "../cli/main.ts";
import { runStep, type SpawnFunction } from "../cli/run.ts";
import {
  STAGE_NAMES,
  type PlanStep,
  type ValidationOperation,
  type ValidationPlan,
} from "./focused-validation-selection.ts";

export function parseArguments(
  args: readonly string[],
  operation: string,
): FocusedOptions {
  return parseFocusedArguments(
    args,
    `Usage: pnpm ${operation}:focused [--base <revision>] [--dry-run] [--only <stage[,stage]>]`,
    { onlyStages: STAGE_NAMES },
  );
}

export function describePlan(
  plan: ValidationPlan,
  only?: readonly string[],
): string {
  const lines = [
    `Focused ${plan.operation}: ${plan.mode}`,
    `Base: ${plan.base}${plan.baseline ? ` (${plan.baseline})` : ""}`,
  ];
  if (plan.reason) lines.push(`Reason: ${plan.reason}`);
  if (plan.operation === "fix") {
    if (plan.mode === "full-fallback")
      lines.push(
        "WARNING: full fix may modify files throughout the repository.",
      );
    else if (
      plan.stages.format.scope === "all" ||
      plan.stages.lint.scope === "all"
    )
      lines.push(
        "WARNING: repository-wide format/lint autofix may modify files throughout the repository.",
      );
  }
  if (only) lines.push(`Only stages: ${only.join(", ")}`);
  for (const name of STAGE_NAMES) {
    const stage = plan.stages[name];
    lines.push(`\n${name}: ${stage.scope} (${stage.targets.length} targets)`);
    lines.push(...stage.targets.map((target) => `  ${target}`));
    lines.push(...stage.reasons.map((reason) => `  Reason: ${reason}`));
  }
  lines.push("\nExecution plan:");
  if (!plan.commands.length) lines.push("  No commands needed.");
  for (const step of plan.commands)
    lines.push(
      `  [${step.stage}] ${formatCommand(step.command, step.args)} — ${step.reason}`,
    );
  return lines.join("\n");
}

const hasNul = (value: string) => value.includes("\0");

/**
 * Reject plans the type system cannot: NUL bytes (argument smuggling), a
 * recursive focused invocation, and a malformed full fallback. Plan shape is
 * guaranteed by `ValidationPlan` for internally produced plans.
 */
export function assertSafePlan(plan: ValidationPlan): void {
  for (const step of plan.commands) {
    if (
      !step.command.trim() ||
      hasNul(step.command) ||
      step.args.some(hasNul) ||
      hasNul(step.reason)
    )
      throw new Error("Invalid validation command");
  }
  if (
    plan.mode === "full-fallback" &&
    (plan.commands.length !== 1 ||
      plan.commands[0]!.stage !== "fallback" ||
      plan.commands[0]!.command !== "pnpm" ||
      plan.commands[0]!.args.length !== 2 ||
      plan.commands[0]!.args[0] !== "run" ||
      plan.commands[0]!.args[1] !== plan.operation ||
      STAGE_NAMES.some(
        (name) =>
          plan.stages[name].scope !== "none" ||
          plan.stages[name].targets.length,
      ))
  )
    throw new Error(
      "Full fallback must invoke pnpm run fix/check exactly once with no selected stages",
    );
  if (
    plan.commands.some(
      (step) =>
        step.command === "pnpm" &&
        step.args.some((arg) => ["fix:focused", "check:focused"].includes(arg)),
    )
  )
    throw new Error("Recursive focused validation command");
}

/**
 * Keep only the commands of the requested stages. Declaration preparation is
 * kept whenever a stage that reads emitted declarations (lint, packages) runs.
 */
export function restrictToStages(
  plan: ValidationPlan,
  only: readonly string[],
): ValidationPlan {
  const wanted = new Set<string>(only);
  if (wanted.has("lint") || wanted.has("packages")) wanted.add("prepare");
  return {
    ...plan,
    commands: plan.commands.filter((step) => wanted.has(step.stage)),
  };
}

export interface ExecuteOptions {
  dryRun?: boolean;
  spawn?: SpawnFunction;
  pnpmPath?: string;
  log?: (line: string) => void;
}

/** Prefer pnpm's JS entrypoint when available, never cmd.exe or a shell. */
function resolveCommand(
  step: PlanStep,
  pnpmPath: string | undefined,
): { command: string; args: string[] } {
  if (
    step.command === "pnpm" &&
    /(?:^|[/\\])pnpm\.(?:c?js|mjs)$/i.test(pnpmPath ?? "")
  )
    return { command: process.execPath, args: [pnpmPath!, ...step.args] };
  return { command: step.command, args: step.args };
}

export function executePlan(
  plan: ValidationPlan,
  root: string,
  {
    dryRun = false,
    spawn = spawnSync as SpawnFunction,
    pnpmPath = process.env.npm_execpath,
    log = console.log,
  }: ExecuteOptions = {},
): void {
  assertSafePlan(plan);
  if (dryRun) return;
  for (const step of plan.commands) {
    section(step.reason, log);
    const { command, args } = resolveCommand(step, pnpmPath);
    runStep(command, args, {
      cwd: root,
      spawn,
      shell: false,
      failure: (result) =>
        `${step.command} failed (${result.signal ?? result.status})`,
    });
  }
}

interface StageResult {
  output: string;
  failure?: string;
}

function runBuffered(
  command: string,
  args: string[],
  cwd: string,
): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawnAsync(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, output }));
  });
}

/**
 * Run a read-only `check` plan with independent stages concurrently. Declaration
 * preparation runs first (later stages read its output); then each stage's
 * commands run in order while the stages themselves overlap, except migration
 * integrity, which builds outputs the others read and therefore runs last. Output is
 * buffered per stage and printed in plan order, so logs never interleave.
 * Returns after every stage finished; throws one CliError naming the failures.
 */
export async function executeCheckPlanConcurrently(
  plan: ValidationPlan,
  root: string,
  {
    pnpmPath = process.env.npm_execpath,
    log = console.log,
  }: Pick<ExecuteOptions, "pnpmPath" | "log"> = {},
): Promise<void> {
  assertSafePlan(plan);
  const prepare = plan.commands.filter((step) => step.stage === "prepare");
  executePlan({ ...plan, commands: prepare }, root, { pnpmPath, log });
  const stages = new Map<string, PlanStep[]>();
  for (const step of plan.commands) {
    if (step.stage === "prepare" || step.stage === "migrations") continue;
    stages.set(step.stage, [...(stages.get(step.stage) ?? []), step]);
  }
  const results = await Promise.all(
    [...stages.entries()].map(
      async ([name, steps]): Promise<[string, StageResult]> => {
        let output = "";
        for (const step of steps) {
          output += `\n${step.reason}\n`;
          const { command, args } = resolveCommand(step, pnpmPath);
          try {
            const result = await runBuffered(command, args, root);
            output += result.output;
            if (result.code !== 0)
              return [
                name,
                {
                  output,
                  failure: `${step.command} failed (${result.signal ?? result.code})`,
                },
              ];
          } catch (error) {
            return [name, { output, failure: (error as Error).message }];
          }
        }
        return [name, { output }];
      },
    ),
  );
  const failures: string[] = [];
  for (const [name, result] of results) {
    log(`\n── ${name} ──${result.output.trimEnd() ? "" : " ok"}`);
    if (result.output.trim()) log(result.output.trimEnd());
    if (result.failure) failures.push(`[${name}] ${result.failure}`);
  }
  if (failures.length) throw new CliError(failures.join("\n"));
  // Migration integrity builds workspace outputs the other stages read, so it
  // never overlaps with them.
  executePlan(
    {
      ...plan,
      commands: plan.commands.filter((step) => step.stage === "migrations"),
    },
    root,
    { pnpmPath, log },
  );
}

export interface MainDependencies extends CliHooks, ExecuteOptions {
  args?: string[];
  planFocusedValidation?: (
    root: string,
    operation: ValidationOperation,
    base: string,
  ) => Promise<ValidationPlan> | ValidationPlan;
}

export async function main(
  operation: string,
  root: string,
  dependencies: MainDependencies = {},
): Promise<void> {
  const {
    args = process.argv.slice(2),
    log = console.log,
    error = console.error,
    setExitCode,
    planFocusedValidation,
    ...executionOptions
  } = dependencies;
  await runCli(
    async () => {
      if (operation !== "fix" && operation !== "check")
        throw new Error(`Unsupported validation operation: ${operation}`);
      const options = parseArguments(args, operation);
      const planner =
        planFocusedValidation ??
        (await import("./focused-validation-selection.ts"))
          .planFocusedValidation;
      let plan = await planner(root, operation, options.base);
      assertSafePlan(plan);
      if (options.only) plan = restrictToStages(plan, options.only);
      log(describePlan(plan, options.only));
      if (options.dryRun) log("\nDry run: no validation commands executed.");
      // Injected spawn (tests) keeps the sequential executor.
      if (operation === "check" && !options.dryRun && !executionOptions.spawn)
        await executeCheckPlanConcurrently(plan, root, {
          ...executionOptions,
          log,
        });
      else
        executePlan(plan, root, {
          ...executionOptions,
          dryRun: options.dryRun,
          log,
        });
    },
    { error, setExitCode },
  );
}
