import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadWorkspace } from "../workspace/graph.ts";
import { defineRule } from "./policy.ts";

/** Workspace packages derived from their manifests (`{ directory, name }`). */
function workspacePackages(repoRoot: string) {
  return [...loadWorkspace(repoRoot)].map(([name, pkg]) => ({
    name,
    directory: pkg.directory.slice("packages/".length),
  }));
}

export const packageExportSurfaces: Readonly<Record<string, string[]>> =
  Object.freeze({
    "@nervekit/contracts": [
      ".",
      "./events",
      "./wire",
      "./operations",
      "./access",
      "./auth",
      "./capabilities",
      "./completions",
      "./core",
      "./filesystem",
      "./git",
      "./logs",
      "./models",
      "./permissions",
      "./pinned-commands",
      "./plans",
      "./projects",
      "./prompt-suggestions",
      "./providers",
      "./scratch-notes",
      "./settings",
      "./skills",
      "./status",
      "./agent-configuration",
      "./agent-profiles",
      "./subagents",
      "./storage",
      "./maintenance",
      "./launch-definitions",
      "./launches",
      "./tools",
      "./transcription",
      "./usage",
      "./paths",
      "./activity",
    ],
    "@nervekit/conversation-core": ["."],
    "@nervekit/desktop-shell": [],
    "@nervekit/harness": [
      ".",
      "./node",
      "./agent",
      "./models",
      "./conversation",
      "./compaction",
      "./resources",
      "./messages",
    ],
    "@nervekit/native": ["."],
    "@nervekit/protocol": [
      ".",
      "./client",
      "./server",
      "./rpc",
      "./streams",
      "./adapters",
    ],
    "@nervekit/tools": [
      ".",
      "./catalog",
      "./policy",
      "./runtime",
      "./result-projection",
      "./git",
      "./execution",
      "./integrations",
    ],
    "@nervekit/quick-script": ["."],
    "@nervekit/ui-kit": [
      ".",
      "./styles/app.css",
      "./styles/theme.css",
      "./styles/base.css",
      "./styles/animation.css",
      "./styles/components.css",
      "./utils",
      "./icons/*",
      "./browser/*",
      "./collections/*",
      "./display/*",
      "./highlighting/*",
      "./renderers/markdown/Markdown.svelte",
      "./renderers/markdown/markdown-render",
      "./renderers/markdown/streaming-markdown",
      "./renderers/mermaid/MermaidDiagram.svelte",
      "./renderers/mermaid/mermaid-blocks",
      "./renderers/media/ImageViewer.svelte",
      "./renderers/plain-text/PlainText.svelte",
      "./scheduling/*",
      "./terminal/*",
      "./components/ui/*",
      "./components/composites/*",
    ],
    "@nervekit/skills": ["."],
    "@nervekit/website": [],
    "@nervekit/workbench-app": [],
    "@nervekit/workbench-server": [".", "./network", "./main"],
  });

export function validateBuiltPackageExportTargets(repoRoot: string): string[] {
  const failures: string[] = [];
  for (const definition of workspacePackages(repoRoot)) {
    const packageRoot = join(repoRoot, "packages", definition.directory);
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    );
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      for (const value of exportTargets(target)) {
        if (!value.startsWith("./")) continue;
        const relativeTarget = value.slice(2);
        if (relativeTarget.includes("*")) {
          if (!wildcardTargetHasMatch(packageRoot, relativeTarget))
            failures.push(
              `${definition.name} ${subpath}: built wildcard target has no match: ${value}`,
            );
        } else if (!existsSync(join(packageRoot, relativeTarget))) {
          failures.push(
            `${definition.name} ${subpath}: missing built export target ${value}`,
          );
        }
      }
    }
  }
  return failures;
}

export function validatePackageExportSurfaces(repoRoot: string): string[] {
  const failures: string[] = [];
  for (const definition of workspacePackages(repoRoot)) {
    const manifestPath = join(
      repoRoot,
      "packages",
      definition.directory,
      "package.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const expected = packageExportSurfaces[definition.name];
    if (!expected) {
      failures.push(`${definition.name}: no export-surface policy`);
      continue;
    }
    const actual = Object.keys(manifest.exports ?? {});
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(
        `${definition.name}: expected exports ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`,
      );
    }
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      for (const value of exportTargets(target)) {
        if (!value.startsWith("./")) {
          failures.push(
            `${definition.name} ${subpath}: export target must be relative: ${value}`,
          );
          continue;
        }
        const sourceTarget = sourceTargetFor(value);
        if (!sourceTarget) continue;
        if (sourceTarget.includes("*")) {
          if (
            !wildcardTargetHasMatch(
              join(repoRoot, "packages", definition.directory),
              sourceTarget,
            )
          )
            failures.push(
              `${definition.name} ${subpath}: wildcard target has no source match: ${sourceTarget}`,
            );
        } else if (
          !existsSync(
            join(repoRoot, "packages", definition.directory, sourceTarget),
          )
        ) {
          failures.push(
            `${definition.name} ${subpath}: missing source target ${sourceTarget}`,
          );
        }
      }
    }
  }
  return failures;
}

function exportTargets(target: unknown): string[] {
  if (typeof target === "string") return [target];
  if (!target || typeof target !== "object") return [];
  return Object.values(target as object).flatMap(exportTargets);
}

function sourceTargetFor(target: string): string | undefined {
  if (target.startsWith("./src/")) return target.slice(2);
  if (!target.startsWith("./dist/")) return undefined;
  if (target.endsWith(".d.ts")) return undefined;
  const relative = target.slice("./dist/".length);
  const tsTarget = `src/${relative.replace(/\.js$/, ".ts")}`;
  return tsTarget;
}

function wildcardTargetHasMatch(packageRoot: string, sourceTarget: string) {
  const star = sourceTarget.indexOf("*");
  const prefix = sourceTarget.slice(0, star);
  const directory = join(
    packageRoot,
    prefix.slice(0, prefix.lastIndexOf("/") + 1),
  );
  return existsSync(directory) && readdirSync(directory).length > 0;
}

export const exportSurfacesRule = defineRule(
  "export-surfaces",
  "package.json exports match the reviewed public surface and resolve to source",
  ({ repoRoot }, fail) => {
    for (const failure of validatePackageExportSurfaces(repoRoot))
      fail("package exports", failure);
  },
);
