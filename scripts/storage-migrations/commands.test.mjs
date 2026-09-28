import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { STORAGE_MIGRATIONS_DIRECTORY } from "../lib/storage-migration-policy.mjs";
import {
  appendRegistryEntry,
  lockState,
  setChecksum,
} from "./command-support.mjs";

test("registry scaffolding creates and extends one explicit ordered list", (t) => {
  const root = mkdtempSync(join(tmpdir(), "nerve-migration-command-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "steps/index.ts");
  appendRegistryEntry(file, "0001-first-step");
  appendRegistryEntry(file, "0002-second-step");
  const source = readFileSync(file, "utf8");
  assert.match(source, /import step0001 from "\.\/0001-first-step\/step\.js"/);
  assert.match(source, /import step0002 from "\.\/0002-second-step\/step\.js"/);
  assert.match(
    source,
    /STORAGE_MIGRATION_STEPS[\s\S]*Object\.freeze\(\[\s*step0001,\s*step0002,\s*\]\)/,
  );
});

test("lock tooling validates and preserves legacy adoption evidence", (t) => {
  const root = mkdtempSync(join(tmpdir(), "nerve-migration-command-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lockFile = join(
    root,
    STORAGE_MIGRATIONS_DIRECTORY,
    "migrations.lock.json",
  );
  const stepFolder = join(
    root,
    STORAGE_MIGRATIONS_DIRECTORY,
    "steps/0001-first-step",
  );
  mkdirSync(stepFolder, { recursive: true });
  writeFileSync(join(stepFolder, "step.ts"), "export default {};\n");
  const legacyAdoptionChecksums = ["a".repeat(64)];
  const lock = {
    format: "nerve-storage-migrations-lock",
    version: 1,
    steps: [
      {
        id: "0001-first-step",
        kind: "schema",
        checksum: "0".repeat(64),
        stage: "draft",
        acceptedChecksums: [],
        legacyAdoptionChecksums,
      },
    ],
  };
  mkdirSync(dirname(lockFile), { recursive: true });
  writeFileSync(lockFile, JSON.stringify(lock));

  const state = lockState(root);
  setChecksum(state.entries[0], root);
  assert.deepEqual(
    state.entries[0].legacyAdoptionChecksums,
    legacyAdoptionChecksums,
  );

  lock.steps[0].legacyAdoptionChecksums = ["invalid"];
  writeFileSync(lockFile, JSON.stringify(lock));
  assert.throws(
    () => lockState(root),
    /legacyAdoptionChecksums must be SHA-256 strings/,
  );
});

test("registry scaffolding refuses an unknown hand-written registry shape", (t) => {
  const root = mkdtempSync(join(tmpdir(), "nerve-migration-command-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "steps/index.ts");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "export default [];\n");
  assert.throws(
    () => appendRegistryEntry(file, "0001-first-step"),
    /must export a STORAGE_MIGRATION_STEPS Object\.freeze array/,
  );
});
