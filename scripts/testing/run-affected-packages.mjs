#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint, runCli } from "../cli/main.mjs";
import { runStep } from "../cli/run.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VALID_COMMANDS = new Set(["build", "check", "test"]);

export function parsePackages(value) {
  const packages = JSON.parse(value ?? "[]");
  if (!Array.isArray(packages))
    throw new Error("Package selection must be an array");
  for (const packageName of packages) {
    if (
      typeof packageName !== "string" ||
      !packageName.startsWith("@nervekit/") ||
      /[\s\0]/.test(packageName)
    ) {
      throw new Error(`Invalid workspace package name: ${String(packageName)}`);
    }
  }
  return [...new Set(packages)].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function pnpmArguments(command, packages) {
  if (!VALID_COMMANDS.has(command)) {
    throw new Error(`Unsupported package command: ${command}`);
  }
  return [
    ...packages.flatMap((packageName) => ["--filter", packageName]),
    "--if-present",
    command,
  ];
}

export function runAffectedPackages(
  command,
  packages,
  spawn = spawnSync,
  cwd = repoRoot,
) {
  if (packages.length === 0) {
    console.log(`No affected workspace packages require ${command}.`);
    return;
  }
  runStep("pnpm", pnpmArguments(command, packages), {
    cwd,
    spawn,
    failure: (result) =>
      `pnpm ${command} failed with exit code ${result.status}`,
  });
}

function main() {
  return runCli(() => {
    const command = process.argv[2];
    const packages = parsePackages(process.env.NERVE_AFFECTED_PACKAGES);
    runAffectedPackages(command, packages);
  });
}

if (isEntrypoint(import.meta.url)) await main();
