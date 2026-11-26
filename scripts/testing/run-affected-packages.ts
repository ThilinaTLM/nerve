#!/usr/bin/env node
import { defineCli } from "../cli/main.ts";
import { pnpmInvocation, runStep, type SpawnFunction } from "../cli/run.ts";
import { repoRoot } from "../workspace/repo.ts";

const VALID_COMMANDS = new Set(["build", "check", "test"]);

export function parsePackages(value: string | undefined): string[] {
  const packages: unknown = JSON.parse(value ?? "[]");
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
  return [...new Set<string>(packages)].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function pnpmArguments(command: string, packages: string[]): string[] {
  if (!VALID_COMMANDS.has(command)) {
    throw new Error(`Unsupported package command: ${command}`);
  }
  return [
    ...packages.flatMap((packageName) => ["--filter", packageName]),
    // Tests read built outputs, not each other: unsorted, a package never
    // waits for an unrelated slow one in an earlier topological level.
    ...(command === "test" ? ["--no-sort"] : []),
    "--if-present",
    command,
  ];
}

export function runAffectedPackages(
  command: string,
  packages: string[],
  spawn?: SpawnFunction,
  cwd: string = repoRoot,
): void {
  if (packages.length === 0) {
    console.log(`No affected workspace packages require ${command}.`);
    return;
  }
  const pnpm = pnpmInvocation(pnpmArguments(command, packages));
  runStep(pnpm.command, pnpm.args, {
    cwd,
    spawn,
    shell: pnpm.shell || undefined,
    failure: (result) =>
      `pnpm ${command} failed with exit code ${result.status}`,
  });
}

await defineCli(import.meta.url, (argv) => {
  const packages = parsePackages(process.env.NERVE_AFFECTED_PACKAGES);
  runAffectedPackages(argv[0] ?? "", packages);
});
