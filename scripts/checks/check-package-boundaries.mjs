import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRepositorySourceInventory } from "./repository-source-inventory.mjs";
import { checkPackageBoundaries } from "./package-boundary-checks.mjs";
import { checkWorkbenchBoundaries } from "./workbench-boundary-checks.mjs";
import { checkUiStyles } from "./ui-style-checks.mjs";
import { checkRetiredSurfaces } from "./retired-surface-checks.mjs";
import { validatePackageExportSurfaces } from "./package-export-surfaces.mjs";
import { contractsSourcePolicyViolations } from "./contracts-source-policy.mjs";
import { serverTestRuntimePolicyViolations } from "./server-test-runtime-policy.mjs";
import { sourceNamingPolicyViolation } from "./source-naming-policy.mjs";
import { storageMigrationPolicyViolations } from "./storage-migration-policy.mjs";
import { storageReadCompatibilityPolicyViolations } from "./storage-read-compatibility.mjs";

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
  for (const violation of storageMigrationPolicyViolations(repoRoot))
    fail("storage migrations", violation);
  for (const violation of storageReadCompatibilityPolicyViolations(repoRoot))
    fail("storage reader compatibility", violation);
  return failures.sort();
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const failures = checkRepositoryBoundaries(
    dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
  );
  if (failures.length > 0) {
    console.error("Package boundary check failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  }
}
