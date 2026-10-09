import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import {
  nerveHomeManifestSchema,
  NERVE_HOME_MANIFEST,
  type NerveHomeManifest,
} from "@nervekit/contracts/settings";
import { pathExists, atomicWriteJson } from "../../storage-bootstrap/json.js";
import type { StoragePaths } from "../../storage-bootstrap/paths.js";
import type { RegisteredStep } from "./step.js";

const FLOOR_ERROR = "Run Nerve 0.34.1 first";

export async function readMigrationHome(
  paths: StoragePaths,
): Promise<{ fresh: boolean; manifest: NerveHomeManifest }> {
  if (!(await pathExists(paths.manifestPath))) {
    if (
      !(await pathExists(paths.home)) ||
      (await readdir(paths.home)).length === 0
    ) {
      return {
        fresh: true,
        manifest: { ...NERVE_HOME_MANIFEST, migrations: [] },
      };
    }
    throw new Error(FLOOR_ERROR);
  }
  let manifest: NerveHomeManifest;
  try {
    manifest = nerveHomeManifestSchema.parse(
      JSON.parse(await readFile(paths.manifestPath, "utf8")),
    );
  } catch {
    throw new Error(FLOOR_ERROR);
  }
  if (!manifest.migrations) {
    if (manifest.version !== 1) throw new Error(FLOOR_ERROR);
    const source = paths.sqlitePath;
    let database: DatabaseSync | undefined;
    try {
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
      if (
        rows.length !== 10 ||
        rows.some((row, index) => row.id !== baselineIds[index])
      ) {
        throw new Error(FLOOR_ERROR);
      }
    } catch {
      throw new Error(FLOOR_ERROR);
    } finally {
      database?.close();
    }
  }
  return { fresh: false, manifest };
}

export function planMigrations(
  manifest: NerveHomeManifest,
  registry: readonly RegisteredStep[],
): RegisteredStep[] {
  const ledger = manifest.migrations ?? [];
  for (const [index, applied] of ledger.entries()) {
    const entry = registry[index];
    if (!entry || entry.step.id !== applied.id)
      throw new Error(
        `Unknown or out-of-order migration ledger ID: ${applied.id}`,
      );
    if (entry.stage === "released" && entry.checksum !== applied.checksum) {
      throw new Error(`Released migration checksum mismatch: ${applied.id}`);
    }
  }
  return registry.slice(ledger.length);
}

export async function recordMigration(
  paths: StoragePaths,
  entry: RegisteredStep,
): Promise<void> {
  // A step may update the coarse version; preserve its manifest changes.
  const manifest = nerveHomeManifestSchema.parse(
    JSON.parse(await readFile(paths.manifestPath, "utf8")),
  );
  await atomicWriteJson(
    paths.manifestPath,
    {
      ...manifest,
      migrations: [
        ...(manifest.migrations ?? []),
        {
          id: entry.step.id,
          checksum: entry.checksum,
          appliedAt: new Date().toISOString(),
        },
      ],
    },
    0o600,
  );
}
