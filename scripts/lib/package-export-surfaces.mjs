import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { workspacePackages } from "./workspace-architecture.mjs";

export const packageExportSurfaces = Object.freeze({
  "@nervekit/contracts": [
    ".",
    "./events",
    "./wire",
    "./operations",
    "./snapshots",
    "./agents",
    "./auth",
    "./completions",
    "./conversations",
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
    "./runs",
    "./scratch-notes",
    "./settings",
    "./skills",
    "./status",
    "./storage",
    "./suspensions",
    "./task-definitions",
    "./tasks",
    "./tools",
    "./transcription",
    "./usage",
  ],
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
  ],
  "@nervekit/ui-kit": [
    ".",
    "./styles/app.css",
    "./styles/theme.css",
    "./styles/base.css",
    "./styles/animation.css",
    "./styles/components.css",
    "./utils",
    "./browser/*",
    "./collections/*",
    "./display/*",
    "./highlighting/*",
    "./renderers/markdown/Markdown.svelte",
    "./renderers/markdown/markdown-render",
    "./renderers/markdown/streaming-markdown",
    "./renderers/mermaid/MermaidDiagram.svelte",
    "./renderers/mermaid/mermaid-blocks",
    "./renderers/plain-text/PlainText.svelte",
    "./scheduling/*",
    "./terminal/*",
    "./components/ui/*",
    "./components/composites/*",
  ],
  "@nervekit/website": [],
  "@nervekit/workbench-app": [],
  "@nervekit/workbench-server": [".", "./main"],
});

export function validateBuiltPackageExportTargets(repoRoot) {
  const failures = [];
  for (const definition of workspacePackages) {
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

export function validatePackageExportSurfaces(repoRoot) {
  const failures = [];
  for (const definition of workspacePackages) {
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

function exportTargets(target) {
  if (typeof target === "string") return [target];
  if (!target || typeof target !== "object") return [];
  return Object.values(target).flatMap(exportTargets);
}

function sourceTargetFor(target) {
  if (target.startsWith("./src/")) return target.slice(2);
  if (!target.startsWith("./dist/")) return undefined;
  if (target.endsWith(".d.ts")) return undefined;
  const relative = target.slice("./dist/".length);
  const tsTarget = `src/${relative.replace(/\.js$/, ".ts")}`;
  return tsTarget;
}

function wildcardTargetHasMatch(packageRoot, sourceTarget) {
  const star = sourceTarget.indexOf("*");
  const prefix = sourceTarget.slice(0, star);
  const directory = join(
    packageRoot,
    prefix.slice(0, prefix.lastIndexOf("/") + 1),
  );
  return existsSync(directory) && readdirSync(directory).length > 0;
}
