import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  packageExportSurfaces,
  validatePackageExportSurfaces,
} from "./package-export-surfaces.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("workspace package export maps match the curated architecture surface", () => {
  assert.deepEqual(validatePackageExportSurfaces(repoRoot), []);
});

test("every workspace package has an explicit export policy", () => {
  assert.deepEqual(Object.keys(packageExportSurfaces).sort(), [
    "@nervekit/contracts",
    "@nervekit/desktop-shell",
    "@nervekit/harness",
    "@nervekit/native",
    "@nervekit/protocol",
    "@nervekit/tools",
    "@nervekit/ui-kit",
    "@nervekit/website",
    "@nervekit/workbench-app",
    "@nervekit/workbench-server",
  ]);
});
