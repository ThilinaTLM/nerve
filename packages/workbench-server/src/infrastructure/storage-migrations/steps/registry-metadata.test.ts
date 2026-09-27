import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { STORAGE_MIGRATION_STEPS } from "./index.js";
import { STORAGE_MIGRATION_REGISTRY_METADATA } from "./registry-metadata.js";

type LockEntry = {
  id: string;
  checksum: string;
  kind: string;
  stage: string;
  acceptedChecksums: string[];
  legacyAdoptionChecksums?: string[];
};

void test("runtime registry metadata mirrors the lock authority", async () => {
  const lockPath = fileURLToPath(
    new URL("../migrations.lock.json", import.meta.url),
  );
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
    steps: LockEntry[];
  };
  assert.deepEqual(
    STORAGE_MIGRATION_REGISTRY_METADATA.map((entry) => ({ ...entry })),
    lock.steps.map((entry, index) => ({
      id: entry.id,
      ordinal: index + 1,
      kind: entry.kind,
      checksum: entry.checksum,
      stage: entry.stage,
      acceptedChecksums: entry.acceptedChecksums,
      ...(entry.legacyAdoptionChecksums
        ? { legacyAdoptionChecksums: entry.legacyAdoptionChecksums }
        : {}),
    })),
  );
  assert.deepEqual(
    STORAGE_MIGRATION_STEPS.map((step) => step.id),
    STORAGE_MIGRATION_REGISTRY_METADATA.map((entry) => entry.id),
  );
});
