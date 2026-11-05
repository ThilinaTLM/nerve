import { spawnSync } from "node:child_process";
import { parseFocusedArguments } from "../cli/args.mjs";
import { runCli } from "../cli/main.mjs";
import { section } from "../cli/log.mjs";
import { runStep } from "../cli/run.mjs";

export function parseArguments(args, operation) {
  return parseFocusedArguments(
    args,
    `Usage: pnpm ${operation}:focused [--base <revision>] [--dry-run]`,
  );
}

const stageNames = [
  "prepare",
  "format",
  "lint",
  "policies",
  "migrations",
  "packages",
  "native",
];
const isText = (value) => typeof value === "string" && !value.includes("\0");
const isTextArray = (value) => Array.isArray(value) && value.every(isText);

export function describePlan(plan) {
  validateCommands(plan);
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
  for (const name of stageNames) {
    const stage = plan.stages[name];
    lines.push(`\n${name}: ${stage.scope} (${stage.targets.length} targets)`);
    lines.push(...stage.targets.map((target) => `  ${target}`));
    lines.push(...stage.reasons.map((reason) => `  Reason: ${reason}`));
  }
  lines.push("\nExecution plan:");
  if (!plan.commands.length) lines.push("  No commands needed.");
  for (const step of plan.commands)
    lines.push(
      `  [${step.stage}] ${[step.command, ...step.args].map((arg) => JSON.stringify(arg)).join(" ")} — ${step.reason}`,
    );
  return lines.join("\n");
}

function validateCommands(plan) {
  if (
    !plan ||
    !["fix", "check"].includes(plan.operation) ||
    !["none", "focused", "mixed", "full-fallback"].includes(plan.mode) ||
    !isText(plan.base) ||
    !(plan.baseline == null || isText(plan.baseline)) ||
    !(plan.reason === undefined || isText(plan.reason)) ||
    !plan.stages ||
    !Array.isArray(plan.commands)
  )
    throw new Error("Invalid validation plan");
  for (const name of stageNames) {
    const stage = plan.stages[name];
    if (
      !stage ||
      !["none", "changed", "packages", "all"].includes(stage.scope) ||
      !isTextArray(stage.targets) ||
      !isTextArray(stage.reasons)
    )
      throw new Error(`Invalid validation stage: ${name}`);
  }
  for (const step of plan.commands) {
    if (
      !step ||
      !(
        stageNames.includes(step.stage) ||
        (plan.mode === "full-fallback" && step.stage === "fallback")
      ) ||
      !isText(step.command) ||
      !step.command.trim() ||
      !isTextArray(step.args) ||
      !isText(step.reason)
    )
      throw new Error("Invalid validation command");
  }
  if (
    plan.mode === "full-fallback" &&
    (plan.commands.length !== 1 ||
      plan.commands[0].stage !== "fallback" ||
      plan.commands[0].command !== "pnpm" ||
      plan.commands[0].args.length !== 2 ||
      plan.commands[0].args[0] !== "run" ||
      plan.commands[0].args[1] !== plan.operation ||
      stageNames.some(
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

export function executePlan(
  plan,
  root,
  {
    dryRun = false,
    spawn = spawnSync,
    pnpmPath = process.env.npm_execpath,
    log = console.log,
  } = {},
) {
  validateCommands(plan);
  if (dryRun) return;
  for (const step of plan.commands) {
    section(step.reason, log);
    let command = step.command;
    let args = step.args;
    // Prefer pnpm's JS entrypoint when available, never cmd.exe or a shell.
    if (
      command === "pnpm" &&
      /(?:^|[/\\])pnpm\.(?:c?js|mjs)$/i.test(pnpmPath ?? "")
    ) {
      command = process.execPath;
      args = [pnpmPath, ...args];
    }
    runStep(command, args, {
      cwd: root,
      spawn,
      shell: false,
      failure: (result) =>
        `${step.command} failed (${result.signal ?? result.status})`,
    });
  }
}

export async function main(operation, root, dependencies = {}) {
  const {
    args = process.argv.slice(2),
    log = console.log,
    error = console.error,
    setExitCode = (code) => {
      process.exitCode = code;
    },
    ...executionOptions
  } = dependencies;
  await runCli(
    async () => {
      if (operation !== "fix" && operation !== "check")
        throw new Error(`Unsupported validation operation: ${operation}`);
      const options = parseArguments(args, operation);
      const planner =
        dependencies.planFocusedValidation ??
        (await import("./focused-validation-selection.mjs"))
          .planFocusedValidation;
      const plan = await planner(root, operation, options.base);
      validateCommands(plan);
      log(describePlan(plan));
      if (options.dryRun) log("\nDry run: no validation commands executed.");
      executePlan(plan, root, { ...executionOptions, ...options, log });
    },
    { error, setExitCode },
  );
}
