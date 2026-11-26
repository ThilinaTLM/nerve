#!/usr/bin/env node
// GitHub Actions entry point: classify a pull request and publish job outputs.
// Runs under plain Node (type stripping) before dependencies are installed, so
// this module graph must stay free of non-erasable TypeScript syntax and npm imports.
import { appendFileSync } from "node:fs";
import { parseCli } from "../cli/args.ts";
import { defineCli } from "../cli/main.ts";
import { execFileSync } from "node:child_process";
import { readChangedPaths, readGitFile } from "../workspace/git.ts";
import { loadWorkspace } from "../workspace/graph.ts";
import { repoRoot } from "../workspace/repo.ts";
import {
  classifyChanges,
  type CiImpact,
  type RootManifestDelta,
} from "./classify.ts";

/** Suites the native job of one OS runs (`[]` skips that OS's jobs). */
const nativeSuites = (impact: CiImpact, osName: string): string[] =>
  impact.nativeMatrix.find((entry) => entry.name === osName)?.suites ?? [];

export function githubOutputs(impact: CiImpact): Record<string, string> {
  return {
    full: String(impact.full),
    packages: JSON.stringify(impact.packages),
    dependency_packages: JSON.stringify(impact.dependencyPackages),
    has_packages: String(impact.packages.length > 0),
    website: String(impact.website),
    workbench: String(impact.workbench),
    native: String(impact.native),
    native_windows_suites: JSON.stringify(nativeSuites(impact, "Windows")),
    native_macos_suites: JSON.stringify(nativeSuites(impact, "macOS")),
  };
}

function parseManifest(text: string | null) {
  if (text === null) return null;
  const value = JSON.parse(text);
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

/** Root `package.json` at the merge-base of `base` and `head`, and at `head`. */
function loadRootManifests(base: string, head: string): RootManifestDelta {
  try {
    const mergeBase = execFileSync("git", ["merge-base", base, head], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    return {
      before: parseManifest(readGitFile(repoRoot, mergeBase, "package.json")),
      after: parseManifest(readGitFile(repoRoot, head, "package.json")),
    };
  } catch (error) {
    return {
      reason: `Cannot compare root manifests: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
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
    const rootManifest = paths.includes("package.json")
      ? loadRootManifests(options.base ?? "", options.head ?? "HEAD")
      : undefined;
    impact = classifyChanges(paths, workspace, {
      full: options.full,
      rootManifest,
    });
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
