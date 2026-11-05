#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { parseFocusedArguments } from "../cli/args.ts";
import { defineCli } from "../cli/main.ts";
import { runSteps, type SpawnFunction } from "../cli/run.ts";
import { repoRoot } from "../workspace/repo.ts";
import { planFocusedTests, type TestPlan } from "./focused-test-selection.ts";

export function parseArguments(args: readonly string[]) {
  return parseFocusedArguments(
    args,
    "Usage: pnpm test:focused [--base <revision>] [--dry-run]",
  );
}

export function executePlan(
  plan: TestPlan,
  root: string,
  {
    dryRun = false,
    spawn = spawnSync as SpawnFunction,
  }: { dryRun?: boolean; spawn?: SpawnFunction } = {},
): void {
  runSteps(plan.commands, { dryRun, spawn, cwd: root });
}

export function describePlan(plan: TestPlan): string {
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

await defineCli(import.meta.url, (argv) => {
  const options = parseArguments(argv);
  const plan = planFocusedTests(repoRoot, options.base);
  console.log(describePlan(plan));
  executePlan(plan, repoRoot, options);
});
