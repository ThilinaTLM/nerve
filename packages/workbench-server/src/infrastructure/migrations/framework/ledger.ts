import type { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import {
  nerveHomeManifestSchema,
  HomeAdmissionError,
  NERVE_HOME_MANIFEST,
  type NerveHomeManifest,
} from "@nervekit/contracts/settings";
import { atomicWriteJson } from "../../storage-bootstrap/json.js";
import {
  isFreshNerveHome,
  inspectNerveHome,
} from "../../storage-bootstrap/state-layout.js";
import type { StoragePaths } from "../../storage-bootstrap/paths.js";
import type { MigrationRegistryEntry, RegisteredStep } from "./step.js";

/** Read only the manifest; legacy baseline admission belongs in the worker. */
export async function readMigrationManifest(
  paths: StoragePaths,
): Promise<NerveHomeManifest | undefined> {
  let bytes: string;
  try {
    bytes = await readFile(paths.manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new HomeAdmissionError(
      "manifest_invalid",
      "The home manifest could not be read.",
    );
  }
  try {
    return nerveHomeManifestSchema.parse(JSON.parse(bytes));
  } catch {
    throw new HomeAdmissionError(
      "manifest_invalid",
      "The home manifest is invalid; supported versions are 1 and 2.",
    );
  }
}

export async function readMigrationHome(
  paths: StoragePaths,
): Promise<{ fresh: boolean; manifest: NerveHomeManifest }> {
  const manifest = await readMigrationManifest(paths);
  if (!manifest) {
    if (await isFreshNerveHome(paths.home)) {
      return {
        fresh: true,
        manifest: { ...NERVE_HOME_MANIFEST, migrations: [] },
      };
    }
    const inspection = await inspectNerveHome(paths.home);
    throw new HomeAdmissionError(
      "layout_unrecognized",
      inspection.kind === "unsupported"
        ? inspection.reason
        : "The home layout is unrecognized.",
    );
  }
  if (!manifest.migrations) {
    if (manifest.version !== 1)
      throw new HomeAdmissionError(
        "ledger_unexpected",
        "The home manifest has no migration ledger.",
      );
    const source = paths.sqlitePath;
    let database: DatabaseSync | undefined;
    try {
      const { DatabaseSync } = await import("node:sqlite");
      database = new DatabaseSync(source, { readOnly: true });
      const rows = database
        .prepare("SELECT id FROM storage_migrations ORDER BY ordinal")
        .all();
      const baselineIds = [
        "0001-nerve-home-v1",
        "0002-atomic-run-lifecycle-work",
        "0003-authoritative-run-lifecycle",
        "0004-convert-run-lifecycle",
        "0005-async-subagent-completions",
        "0006-explore-agent-names",
        "0007-agent-async-obligations",
        "0008-tool-result-payload-reference",
        "0009-agent-async-obligations-backfill",
        "0010-deletion-indexes",
      ];
      const knownPrefix = rows
        .slice(0, baselineIds.length)
        .every((row, index) => row.id === baselineIds[index]);
      if (!knownPrefix)
        throw new HomeAdmissionError(
          "ledger_unexpected",
          "The baseline migration ledger contains unexpected entries.",
        );
      if (rows.length < baselineIds.length)
        throw new HomeAdmissionError(
          "too_old",
          "This home predates the supported baseline. Run Nerve 0.34.1 once before upgrading.",
        );
    } catch (error) {
      if (error instanceof HomeAdmissionError) throw error;
      throw new HomeAdmissionError(
        "ledger_unexpected",
        "The baseline migration ledger could not be read.",
      );
    } finally {
      database?.close();
    }
  }
  return { fresh: false, manifest };
}

export function planMigrations<T extends MigrationRegistryEntry>(
  manifest: NerveHomeManifest,
  registry: readonly T[],
): T[] {
  const ledger = manifest.migrations ?? [];
  for (const [index, applied] of ledger.entries()) {
    const entry = registry[index];
    if (!entry || entry.step.id !== applied.id)
      throw new HomeAdmissionError(
        "ledger_unexpected",
        `Unknown or out-of-order migration ledger ID: ${applied.id}`,
      );
    if (entry.stage === "released" && entry.checksum !== applied.checksum) {
      throw new HomeAdmissionError(
        "ledger_unexpected",
        `Released migration checksum mismatch: ${applied.id}`,
      );
    }
  }
  return [
    ...registry
      .slice(0, ledger.length)
      .filter(
        (entry, index) =>
          entry.stage === "draft" &&
          entry.rerunOnChange &&
          entry.checksum !== ledger[index].checksum,
      ),
    ...registry.slice(ledger.length),
  ];
}

export async function recordMigration(
  paths: StoragePaths,
  entry: RegisteredStep,
): Promise<void> {
  // A step may update the coarse version; preserve its manifest changes.
  const manifest = nerveHomeManifestSchema.parse(
    JSON.parse(await readFile(paths.manifestPath, "utf8")),
  );
  const migrations = [...(manifest.migrations ?? [])];
  const applied = {
    id: entry.step.id,
    checksum: entry.checksum,
    appliedAt: new Date().toISOString(),
  };
  const index = migrations.findIndex((item) => item.id === entry.step.id);
  if (index < 0) migrations.push(applied);
  else migrations[index] = applied;
  await atomicWriteJson(paths.manifestPath, { ...manifest, migrations }, 0o600);
}
