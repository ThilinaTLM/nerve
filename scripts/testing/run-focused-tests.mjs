#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planFocusedTests } from "./focused-test-selection.mjs";

export function parseArguments(args) {
  const options = { base: "origin/main", dryRun: false };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--dry-run") options.dryRun = true;
    else if (
      args[index] === "--base" &&
      args[index + 1] &&
      !args[index + 1].startsWith("--")
    )
      options.base = args[++index];
    else
      throw new Error(
        "Usage: pnpm test:focused [--base <revision>] [--dry-run]",
      );
  }
  return options;
}

export function executePlan(
  plan,
  root,
  { dryRun = false, spawn = spawnSync } = {},
) {
  if (dryRun) return;
  for (const step of plan.commands) {
    console.log(`\n${step.reason}`);
    const result = spawn(step.command, step.args, {
      cwd: root,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `${step.command} failed (${result.signal ?? result.status})`,
      );
  }
}

export function describePlan(plan) {
  const lines = [
    `Focused tests: ${plan.mode}`,
    `Base: ${plan.base}${plan.baseline ? ` (${plan.baseline})` : ""}`,
  ];
  if (plan.reason) lines.push(plan.reason);
  if (plan.mode === "focused")
    lines.push(
      `${plan.selected}/${plan.total} test files in potentially affected packages; root script baseline also runs.`,
    );
  for (const pkg of plan.packages) {
    lines.push(
      `\n${pkg.name}${pkg.fallback.length ? " (complete package suite)" : ""}`,
    );
    for (const test of pkg.tests)
      lines.push(`  ${test.file}\n    ${test.reasons.join("\n    ")}`);
  }
  lines.push(
    "\nExecution plan:",
    ...plan.commands.map(
      (step) =>
        `  ${step.command} ${step.args.map((arg) => JSON.stringify(arg)).join(" ")} — ${step.reason}`,
    ),
  );
  return lines.join("\n");
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  try {
    const options = parseArguments(process.argv.slice(2));
    const plan = planFocusedTests(root, options.base);
    console.log(describePlan(plan));
    executePlan(plan, root, options);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
