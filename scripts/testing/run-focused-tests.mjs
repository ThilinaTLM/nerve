#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFocusedArguments } from "../cli/args.mjs";
import { isEntrypoint, runCli } from "../cli/main.mjs";
import { section } from "../cli/log.mjs";
import { runStep } from "../cli/run.mjs";
import { planFocusedTests } from "./focused-test-selection.mjs";

export function parseArguments(args) {
  return parseFocusedArguments(
    args,
    "Usage: pnpm test:focused [--base <revision>] [--dry-run]",
  );
}

export function executePlan(
  plan,
  root,
  { dryRun = false, spawn = spawnSync } = {},
) {
  if (dryRun) return;
  for (const step of plan.commands) {
    section(step.reason);
    runStep(step.command, step.args, { cwd: root, spawn });
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
    for (const test of [...pkg.tests, ...pkg.components])
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
  return runCli(() => {
    const options = parseArguments(process.argv.slice(2));
    const plan = planFocusedTests(root, options.base);
    console.log(describePlan(plan));
    executePlan(plan, root, options);
  });
}
if (isEntrypoint(import.meta.url)) await main();
