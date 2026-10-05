#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  readStorageMigrationLock,
  STORAGE_MIGRATIONS_DIRECTORY,
  storageMigrationChecksum,
  storageMigrationLockMetadataViolations,
  storageMigrationPolicyViolations,
} from "../checks/storage-migration-policy.mjs";

const registryFile = `${STORAGE_MIGRATIONS_DIRECTORY}/steps/registry-metadata.ts`;

export function checkStorageMigrationReleaseState(repoRoot) {
  const state = readStorageMigrationLock(repoRoot);
  if (!state) throw new Error("Storage migration lock is missing.");
  const failures = [
    ...storageMigrationLockMetadataViolations(state.entries),
    ...storageMigrationPolicyViolations(repoRoot),
  ];
  for (const entry of state.entries) {
    if (entry.stage === "draft")
      failures.push(`${entry.id}: draft migrations cannot be released`);
    const folder = resolve(
      repoRoot,
      STORAGE_MIGRATIONS_DIRECTORY,
      "steps",
      entry.id,
    );
    if (!existsSync(folder)) {
      failures.push(`${entry.id}: migration step folder is missing`);
    } else if (storageMigrationChecksum(folder) !== entry.checksum) {
      failures.push(`${entry.id}: migration step checksum is dirty`);
    }
  }
  const expected = renderRuntimeRegistry(state.entries);
  const actual = readFileSync(resolve(repoRoot, registryFile), "utf8");
  if (actual !== expected)
    failures.push(
      "runtime migration registry metadata is out of sync with the lock",
    );
  if (failures.length > 0)
    throw new Error(
      `Storage migration release checks failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  return state;
}

export function stampStorageMigrationRelease(repoRoot, version) {
  const state = checkStorageMigrationReleaseState(repoRoot);
  let stamped = 0;
  for (const entry of state.entries) {
    if (entry.stage !== "final") continue;
    entry.stage = "released";
    entry.releasedIn = version;
    stamped += 1;
  }
  writeFileSync(state.file, `${JSON.stringify(state.lock, null, 2)}\n`);
  writeFileSync(
    resolve(repoRoot, registryFile),
    renderRuntimeRegistry(state.entries),
  );
  checkStorageMigrationReleaseState(repoRoot);
  return {
    stamped,
    lockFile: state.file,
    registryFile: resolve(repoRoot, registryFile),
  };
}

export function validateReleaseStorageFixture(repoRoot, version) {
  const root = resolve(
    repoRoot,
    "packages/workbench-server/test/fixtures/storage/releases",
    version,
  );
  const manifestPath = resolve(root, "manifest.json");
  const sqlitePath = resolve(root, "data/nerve.sqlite");
  const configPath = resolve(root, "config");
  if (
    !existsSync(manifestPath) ||
    !existsSync(sqlitePath) ||
    !existsSync(configPath)
  )
    throw new Error(
      `Release storage fixture ${version} is missing. Generate a sanitized standard home at ${root}, then run: node scripts/storage-migrations/release-lifecycle.mjs check-fixture ${version}`,
    );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest?.format !== "nerve-home" ||
    manifest?.version !== 2 ||
    manifest?.homeClass !== "standard"
  )
    throw new Error(
      `Release storage fixture ${version} has an invalid manifest.`,
    );
  const sqliteUrl = pathToFileURL(sqlitePath);
  sqliteUrl.searchParams.set("immutable", "1");
  const database = new DatabaseSync(sqliteUrl, { readOnly: true });
  try {
    const row = database.prepare("PRAGMA quick_check").get();
    if (row?.quick_check !== "ok")
      throw new Error(
        `Release storage fixture ${version} failed SQLite quick_check.`,
      );
  } finally {
    database.close();
  }
  return root;
}

export function renderRuntimeRegistry(entries) {
  const registry = runtimeEntries(entries)
    .map((entry) => renderRuntimeEntry(entry))
    .join("\n");
  return `import type { MigrationStepKindV1 } from "../kit/define-step/v1.js";\n\nexport type StorageMigrationStage = "draft" | "final" | "released";\n\nexport interface StorageMigrationRegistryMetadata {\n  readonly id: string;\n  readonly ordinal: number;\n  readonly kind: MigrationStepKindV1;\n  readonly checksum: string;\n  readonly stage: StorageMigrationStage;\n  readonly acceptedChecksums: readonly string[];\n  /** Legacy raw-SQL checksums used only while adopting pre-framework ledgers. */\n  readonly legacyAdoptionChecksums?: readonly string[];\n}\n\n/**\n * Generated from migrations.lock.json by the release lifecycle tooling.\n * The JSON lock remains the tooling/review authority.\n */\nexport const STORAGE_MIGRATION_REGISTRY_METADATA = [\n${registry}\n] as const satisfies readonly StorageMigrationRegistryMetadata[];\n`;
}

function renderRuntimeEntry(entry) {
  const lines = [
    "  {",
    `    id: ${JSON.stringify(entry.id)},`,
    `    ordinal: ${entry.ordinal},`,
    `    kind: ${JSON.stringify(entry.kind)},`,
    "    checksum:",
    `      ${JSON.stringify(entry.checksum)},`,
    `    stage: ${JSON.stringify(entry.stage)},`,
    ...renderStringArray("acceptedChecksums", entry.acceptedChecksums),
  ];
  if (entry.legacyAdoptionChecksums) {
    lines.push(
      ...renderStringArray(
        "legacyAdoptionChecksums",
        entry.legacyAdoptionChecksums,
      ),
    );
  }
  lines.push("  },");
  return lines.join("\n");
}

function renderStringArray(name, values) {
  if (values.length === 0) return [`    ${name}: [],`];
  return [
    `    ${name}: [`,
    ...values.map((value) => `      ${JSON.stringify(value)},`),
    "    ],",
  ];
}

function runtimeEntries(entries) {
  return entries.map((entry, index) => ({
    id: entry.id,
    ordinal: index + 1,
    kind: entry.kind,
    checksum: entry.checksum,
    stage: entry.stage,
    acceptedChecksums: entry.acceptedChecksums ?? [],
    ...(entry.legacyAdoptionChecksums
      ? { legacyAdoptionChecksums: entry.legacyAdoptionChecksums }
      : {}),
  }));
}

async function main() {
  const [command, version] = process.argv.slice(2);
  const repoRoot = process.env.NERVE_REPO_ROOT ?? process.cwd();
  if (command === "check") {
    checkStorageMigrationReleaseState(repoRoot);
    return;
  }
  if (command === "stamp" && version) {
    const result = stampStorageMigrationRelease(repoRoot, version);
    console.log(
      `Stamped ${result.stamped} final storage migration(s) for ${version}.`,
    );
    return;
  }
  if (command === "check-fixture" && version) {
    console.log(
      `Validated release storage fixture: ${validateReleaseStorageFixture(repoRoot, version)}`,
    );
    return;
  }
  throw new Error(
    "Usage: release-lifecycle.mjs <check|stamp VERSION|check-fixture VERSION>",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
