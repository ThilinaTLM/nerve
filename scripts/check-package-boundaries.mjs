import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRepositorySourceInventory } from "./lib/repository-source-inventory.mjs";
import { checkPackageBoundaries } from "./lib/package-boundary-checks.mjs";
import { checkWorkbenchBoundaries } from "./lib/workbench-boundary-checks.mjs";
import { checkUiStyles } from "./lib/ui-style-checks.mjs";
import { checkRetiredSurfaces } from "./lib/retired-surface-checks.mjs";
import { validatePackageExportSurfaces } from "./lib/package-export-surfaces.mjs";
import { contractsSourcePolicyViolations } from "./lib/contracts-source-policy.mjs";
import { serverTestRuntimePolicyViolations } from "./lib/server-test-runtime-policy.mjs";
import { sourceNamingPolicyViolation } from "./lib/source-naming-policy.mjs";

export function checkRepositoryBoundaries(repoRoot) {
  const inventory = createRepositorySourceInventory(repoRoot);
  const failures = [];
  const fail = (file, message) => failures.push(`${file}: ${message}`);
  checkPackageBoundaries(inventory, fail);
  for (const failure of validatePackageExportSurfaces(repoRoot))
    fail("package exports", failure);
  for (const file of inventory.files) {
    const source = inventory.read(file);
    for (const violation of contractsSourcePolicyViolations(file, source))
      fail(file, violation);
    for (const violation of serverTestRuntimePolicyViolations(file, source))
      fail(file, violation);
    const namingViolation = sourceNamingPolicyViolation(file);
    if (namingViolation) fail(file, namingViolation);
  }
  checkRetiredSurfaces(inventory, fail);
  checkWorkbenchBoundaries(inventory, fail);
  checkUiStyles(inventory, fail);
  return failures.sort();
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const failures = checkRepositoryBoundaries(
    dirname(dirname(fileURLToPath(import.meta.url))),
  );
  if (failures.length > 0) {
    console.error("Package boundary check failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  }
}
