import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBuiltPackageExportTargets } from "./lib/package-export-surfaces.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const failures = validateBuiltPackageExportTargets(repoRoot);
if (failures.length) {
  console.error("Built package export validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}
