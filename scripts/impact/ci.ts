#!/usr/bin/env node
// GitHub Actions entry point: classify a pull request and publish job outputs.
// Runs under plain Node (type stripping) before dependencies are installed, so
// this module graph must stay free of non-erasable TypeScript syntax and npm imports.
import { appendFileSync } from "node:fs";
import { parseCli } from "../cli/args.ts";
import { defineCli } from "../cli/main.ts";
import { readChangedPaths } from "../workspace/git.ts";
import { loadWorkspace } from "../workspace/graph.ts";
import { repoRoot } from "../workspace/repo.ts";
import { classifyChanges, type CiImpact } from "./classify.ts";

export function githubOutputs(impact: CiImpact): Record<string, string> {
  return {
    full: String(impact.full),
    packages: JSON.stringify(impact.packages),
    dependency_packages: JSON.stringify(impact.dependencyPackages),
    has_packages: String(impact.packages.length > 0),
    website: String(impact.website),
    workbench: String(impact.workbench),
    electron_smoke: String(impact.electronSmoke),
    native: String(impact.native),
    native_matrix: JSON.stringify({ include: impact.nativeMatrix }),
    native_matrix_needed: String(impact.nativeMatrixNeeded),
    native_os_matrix: JSON.stringify({ include: impact.nativeOsMatrix }),
    native_os_needed: String(impact.nativeOsMatrix.length > 0),
    rust_lint: String(impact.rustLint),
  };
}

function main(argv: string[]) {
  const options = parseCli(
    "ci.ts",
    {
      base: {
        type: "string",
        description: "Git base revision (pull requests)",
      },
      head: {
        type: "string",
        description: "Git head revision",
        default: "HEAD",
      },
      full: { type: "boolean", description: "Select full coverage" },
    },
    argv,
  );
  const workspace = loadWorkspace(repoRoot);
  let impact: CiImpact;
  try {
    const paths = options.full
      ? []
      : readChangedPaths(repoRoot, options.base ?? "", options.head);
    impact = classifyChanges(paths, workspace, { full: options.full });
  } catch (error) {
    console.error(
      `Could not determine affected CI scope; using full coverage: ${error instanceof Error ? error.message : String(error)}`,
    );
    impact = classifyChanges([], workspace, { full: true });
  }

  const outputs = githubOutputs(impact);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `${Object.entries(outputs)
        .map(([name, value]) => `${name}=${value}`)
        .join("\n")}\n`,
    );
  }
  console.log(
    JSON.stringify({ ...impact, changedAgainst: options.base }, null, 2),
  );
}

await defineCli(import.meta.url, main);
