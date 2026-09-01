import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { storageCleanupOperationSchema } from "@nervekit/contracts/storage";
import { z } from "zod";
import type { CanonicalStore } from "../persistence/canonical-sqlite/index.js";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../storage-bootstrap/json.js";
import type { StoragePaths } from "../storage-bootstrap/paths.js";

export const OPERATIONAL_STATE_MIGRATION = "operational-state-to-sqlite-v1";

const outcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), result: z.unknown() }),
  z.object({
    status: z.literal("error"),
    error: z.object({
      code: z.string().max(64),
      message: z.string().max(512),
      retryable: z.boolean(),
      close: z.boolean().optional(),
      details: z.record(z.string(), z.unknown()).optional(),
      recovery: z.unknown().optional(),
    }),
  }),
]);
const idempotencyFileSchema = z.object({
  version: z.literal(1),
  entries: z
    .array(
      z.object({
        scope: z.string().max(256),
        key: z.string().max(256),
        method: z.string().max(256),
        paramsHash: z.string().max(128),
        outcome: outcomeSchema,
        expiresAt: z.number().int().nonnegative(),
      }),
    )
    .max(1_000),
});
const trustStoreSchema = z.object({
  version: z.literal(1),
  projects: z.record(
    z.string(),
    z.object({
      digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      trustedAt: z.string().datetime(),
    }),
  ),
});
type MigrationLedger = {
  format: string;
  version: number;
  entries: Array<{ id?: unknown; [key: string]: unknown }>;
};

export async function migrateOperationalState(
  paths: StoragePaths,
  store: CanonicalStore,
  now = Date.now(),
): Promise<void> {
  const ledger = await readJsonFile<MigrationLedger>(paths.migrationLedgerPath);
  const recorded = ledger.entries.some(
    (entry) => entry.id === OPERATIONAL_STATE_MIGRATION,
  );
  const roots = [
    join(paths.dataPath, "idempotency"),
    join(paths.dataPath, "maintenance"),
    join(paths.dataPath, "permissions"),
  ];
  if (recorded) {
    for (const root of roots) await quarantineTree(paths, root, "reappeared");
    return;
  }

  await importIdempotency(paths, store, now);
  await importMaintenance(paths, store);
  await importTrust(paths, store);
  for (const root of roots) await quarantineUnknownAndRemove(paths, root);
  ledger.entries.push({
    id: OPERATIONAL_STATE_MIGRATION,
    appliedAt: new Date(now).toISOString(),
  });
  await atomicWriteJson(paths.migrationLedgerPath, ledger, 0o600);
}

async function importIdempotency(
  paths: StoragePaths,
  store: CanonicalStore,
  now: number,
): Promise<void> {
  const path = join(paths.dataPath, "idempotency", "http-v1.json");
  if (!(await pathExists(path))) return;
  const value = await parseLegacyFile(path, idempotencyFileSchema).catch(
    async () => {
      await quarantine(paths, path, "invalid-idempotency.json");
      return undefined;
    },
  );
  if (!value) return;
  const pending = [];
  for (const [index, entry] of value.entries.entries()) {
    if (entry.expiresAt <= now) continue;
    const current = await store.readRpcIdempotency(entry.scope, entry.key, now);
    if (current) {
      if (
        current.method !== entry.method ||
        current.paramsHash !== entry.paramsHash ||
        JSON.stringify(current.outcome) !== JSON.stringify(entry.outcome)
      ) {
        await quarantine(paths, path, "conflicting-idempotency.json");
        return;
      }
      continue;
    }
    pending.push({ ...entry, createdAt: now + index });
  }
  for (const entry of pending)
    await store.writeRpcIdempotency(entry, 1_000, now);
  await rm(path, { force: true });
}

async function importMaintenance(
  paths: StoragePaths,
  store: CanonicalStore,
): Promise<void> {
  const path = join(paths.dataPath, "maintenance", "storage-cleanup.json");
  if (!(await pathExists(path))) return;
  const operation = await parseLegacyFile(
    path,
    storageCleanupOperationSchema,
  ).catch(async () => {
    await quarantine(paths, path, "invalid-storage-cleanup.json");
    return undefined;
  });
  if (!operation) return;
  const current = await store.readDocument(
    "maintenance",
    "global",
    "storage-cleanup",
  );
  if (current && JSON.stringify(current.data) !== JSON.stringify(operation)) {
    await quarantine(paths, path, "conflicting-storage-cleanup.json");
    return;
  }
  if (!current)
    await store.writeDocument({
      namespace: "maintenance",
      scopeId: "global",
      documentId: "storage-cleanup",
      data: operation,
      expectedRevision: 0,
    });
  await rm(path, { force: true });
}

async function importTrust(
  paths: StoragePaths,
  store: CanonicalStore,
): Promise<void> {
  const path = join(paths.dataPath, "permissions", "project-trust.json");
  if (!(await pathExists(path))) return;
  const value = await parseLegacyFile(path, trustStoreSchema).catch(
    async () => {
      await quarantine(paths, path, "invalid-project-trust.json");
      return undefined;
    },
  );
  if (!value) return;
  const pending: Array<{
    projectId: string;
    data: { version: 1; digest: string; trustedAt: string };
  }> = [];
  for (const [projectId, record] of Object.entries(value.projects)) {
    const current = await store.readDocument(
      "project-permission-trust",
      "global",
      projectId,
    );
    const data = { version: 1 as const, ...record };
    if (current && JSON.stringify(current.data) !== JSON.stringify(data)) {
      await quarantine(paths, path, "conflicting-project-trust.json");
      return;
    }
    if (!current) pending.push({ projectId, data });
  }
  for (const { projectId, data } of pending)
    await store.writeDocument({
      namespace: "project-permission-trust",
      scopeId: "global",
      documentId: projectId,
      data,
      expectedRevision: 0,
    });
  await rm(path, { force: true });
}

async function parseLegacyFile<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  return schema.parse(await readJsonFile(path));
}

async function quarantineUnknownAndRemove(
  paths: StoragePaths,
  root: string,
): Promise<void> {
  if (!(await pathExists(root))) return;
  for (const entry of await readdir(root)) {
    await quarantine(
      paths,
      join(root, entry),
      `unknown-${basename(root)}-${entry}`,
    );
  }
  await rm(root, { recursive: true, force: true });
}

async function quarantineTree(
  paths: StoragePaths,
  root: string,
  reason: string,
): Promise<void> {
  if (!(await pathExists(root))) return;
  for (const entry of await readdir(root)) {
    await quarantine(
      paths,
      join(root, entry),
      `${reason}-${basename(root)}-${entry}`,
    );
  }
  await rm(root, { recursive: true, force: true });
}

async function quarantine(
  paths: StoragePaths,
  source: string,
  name: string,
): Promise<void> {
  if (!(await pathExists(source))) return;
  const root = join(paths.migrationsPath, OPERATIONAL_STATE_MIGRATION);
  await mkdir(root, { recursive: true, mode: 0o700 });
  let target = join(root, name);
  let suffix = 1;
  while (await pathExists(target)) target = join(root, `${name}.${suffix++}`);
  await rename(source, target);
  await atomicWriteJson(
    join(root, "report.json"),
    { migration: OPERATIONAL_STATE_MIGRATION, quarantined: true },
    0o600,
  );
}
