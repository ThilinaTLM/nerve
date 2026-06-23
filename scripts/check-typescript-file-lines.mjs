#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const MAX_LINES = 800;
const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "release",
  ".svelte-kit",
  ".vite",
]);
const EXCLUDED_PATH_PREFIXES = [
  "packages/desktop/build",
  "packages/desktop/release",
];

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/").replace(/^\.\//, "");
}

function isExcluded(filePath) {
  const normalized = normalizePath(filePath);
  const parts = normalized.split("/");

  if (parts.some((part) => EXCLUDED_DIRECTORY_NAMES.has(part))) {
    return true;
  }

  return EXCLUDED_PATH_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

function isTypeScriptFile(filePath) {
  return TYPESCRIPT_EXTENSIONS.has(path.extname(filePath));
}

function lineCount(filePath) {
  const content = readFileSync(filePath, "utf8");

  if (content.length === 0) {
    return 0;
  }

  const newlineCount = content.match(/\n/g)?.length ?? 0;
  return content.endsWith("\n") ? newlineCount : newlineCount + 1;
}

function trackedAndUntrackedFiles() {
  try {
    return execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      {
        encoding: "utf8",
      },
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    return undefined;
  }
}

function walkFiles(rootPath) {
  const results = [];
  const pending = [rootPath];

  while (pending.length > 0) {
    const currentPath = pending.pop();

    if (!currentPath || isExcluded(currentPath) || !existsSync(currentPath)) {
      continue;
    }

    const stats = statSync(currentPath);

    if (stats.isDirectory()) {
      for (const entry of readdirSync(currentPath)) {
        pending.push(path.join(currentPath, entry));
      }
      continue;
    }

    if (stats.isFile()) {
      results.push(normalizePath(currentPath));
    }
  }

  return results;
}

function candidateFiles() {
  const gitFiles = trackedAndUntrackedFiles();
  const files = gitFiles ?? walkFiles(".");

  return files.filter(
    (filePath) => isTypeScriptFile(filePath) && !isExcluded(filePath),
  );
}

const violations = candidateFiles()
  .map((filePath) => ({ filePath, lines: lineCount(filePath) }))
  .filter(({ lines }) => lines > MAX_LINES)
  .sort(
    (left, right) =>
      right.lines - left.lines || left.filePath.localeCompare(right.filePath),
  );

if (violations.length === 0) {
  console.log(`No TypeScript files exceed ${MAX_LINES} lines.`);
  process.exit(0);
}

console.error(`TypeScript files over ${MAX_LINES} lines:`);
for (const { filePath, lines } of violations) {
  console.error(`  ${lines.toString().padStart(4, " ")}  ${filePath}`);
}
console.error(
  `\nSplit these files or move focused logic into smaller modules before merging.`,
);
process.exit(1);
