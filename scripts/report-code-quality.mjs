#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  analyzeCodeQuality,
  renderCodeQualityReport,
} from "./lib/code-quality-report.mjs";
import { createRepositorySourceInventory } from "./lib/repository-source-inventory.mjs";
import { repoRoot } from "./lib/workspace-packages.mjs";

export async function runCodeQualityReport(args = process.argv.slice(2)) {
  args = args.filter((argument) => argument !== "--");
  const outputIndex = args.indexOf("--output");
  if (outputIndex !== -1 && !args[outputIndex + 1]) {
    throw new Error("--output requires a path.");
  }
  const unknown = args.filter(
    (arg, index) =>
      arg !== "--json" &&
      arg !== "--output" &&
      (index === 0 || args[index - 1] !== "--output"),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown argument: ${unknown[0]}`);
  }

  const report = analyzeCodeQuality(createRepositorySourceInventory(repoRoot));
  const content = args.includes("--json")
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderCodeQualityReport(report);
  if (outputIndex !== -1) {
    await writeFile(resolve(args[outputIndex + 1]), content, "utf8");
  } else {
    process.stdout.write(content);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCodeQualityReport().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
