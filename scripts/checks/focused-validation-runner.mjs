import { spawnSync } from "node:child_process";

export function parseArguments(args, operation) {
  const options = { base: "origin/main", dryRun: false };
  const usage = `Usage: pnpm ${operation}:focused [--base <revision>] [--dry-run]`;
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (seen.has(arg)) throw new Error(usage);
    seen.add(arg);
    if (arg === "--dry-run") options.dryRun = true;
    else if (
      arg === "--base" &&
      args[index + 1]?.trim() &&
      !args[index + 1].startsWith("-")
    )
      options.base = args[++index];
    else throw new Error(usage);
  }
  return options;
}

export function describePlan(plan) {
  const lines = [
    `Focused ${plan.operation}: ${plan.mode}`,
    `Base: ${plan.base}${plan.baseline ? ` (${plan.baseline})` : ""}`,
  ];
  if (plan.reason) lines.push(`Reason: ${plan.reason}`);
  if (plan.mode === "full" && plan.operation === "fix")
    lines.push("WARNING: full fix may modify files throughout the repository.");
  for (const kind of ["format", "lint"]) {
    lines.push(
      `\n${kind === "format" ? "Format" : "Lint"} files (${plan.files[kind].length}):`,
    );
    lines.push(...plan.files[kind].map((file) => `  ${file}`));
  }
  lines.push(`\nPackages (${plan.packages.length}):`);
  lines.push(...plan.packages.map((name) => `  ${name}`));
  lines.push("\nExecution plan:");
  if (!plan.commands.length) lines.push("  No commands needed.");
  for (const step of plan.commands)
    lines.push(
      `  ${[step.command, ...step.args].map((arg) => JSON.stringify(arg)).join(" ")} — ${step.reason}`,
    );
  return lines.join("\n");
}

function validateCommands(plan) {
  for (const step of plan.commands) {
    if (
      typeof step.command !== "string" ||
      !step.command ||
      step.command.includes("\0") ||
      !Array.isArray(step.args) ||
      step.args.some((arg) => typeof arg !== "string" || arg.includes("\0"))
    )
      throw new Error("Invalid validation command");
  }
  if (
    plan.mode === "full" &&
    (plan.commands.length !== 1 ||
      plan.commands[0].command !== "pnpm" ||
      plan.commands[0].args.length !== 2 ||
      plan.commands[0].args[0] !== "run" ||
      plan.commands[0].args[1] !== plan.operation)
  )
    throw new Error(
      "Full fallback must invoke pnpm run fix/check exactly once",
    );
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
    log(`\n${step.reason}`);
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
    const result = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `${step.command} failed (${result.signal ?? result.status})`,
      );
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
  try {
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
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause));
    setExitCode(1);
  }
}
