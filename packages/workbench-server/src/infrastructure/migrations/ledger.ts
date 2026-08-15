import { createHash } from "node:crypto";
import { z } from "zod";
import { atomicWriteJson, pathExists, readJsonFile } from "../storage/json.js";
import type { StorageMigration } from "./migration.js";
import { MigrationError } from "./migration.js";

const entrySchema = z.object({
  id: z.string().min(1),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  description: z.string().min(1),
  appliedAt: z.string().datetime(),
  execution: z.enum(["ran", "detected"]),
});

export const migrationLedgerSchema = z.object({
  format: z.literal("nerve-storage-migrations"),
  version: z.literal(1),
  applied: z.array(entrySchema),
  lastSuccessfulBatch: z
    .object({ id: z.string(), committedAt: z.string().datetime() })
    .optional(),
});
export type MigrationLedger = z.infer<typeof migrationLedgerSchema>;

export function emptyLedger(): MigrationLedger {
  return { format: "nerve-storage-migrations", version: 1, applied: [] };
}

export async function readLedger(path: string): Promise<MigrationLedger> {
  if (!(await pathExists(path))) return emptyLedger();
  const parsed = migrationLedgerSchema.safeParse(await readJsonFile(path));
  if (!parsed.success) {
    throw new MigrationError(
      `Migration ledger is invalid: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export function validateLedger(
  ledger: MigrationLedger,
  registry: readonly StorageMigration[],
): void {
  if (ledger.applied.length > registry.length) {
    throw new MigrationError(
      "Migration ledger contains migrations unknown to this build.",
    );
  }
  for (const [index, entry] of ledger.applied.entries()) {
    const definition = registry[index];
    if (!definition || definition.id !== entry.id) {
      throw new MigrationError(
        `Migration ledger is out of order or contains unknown migration '${entry.id}'.`,
      );
    }
    if (definition.checksum !== entry.checksum) {
      throw new MigrationError(
        `Applied migration '${entry.id}' was edited (checksum mismatch).`,
        entry.id,
      );
    }
  }
}

export async function writeLedger(
  path: string,
  ledger: MigrationLedger,
): Promise<void> {
  await atomicWriteJson(path, migrationLedgerSchema.parse(ledger), 0o600);
}

export function ledgerDigest(ledger: MigrationLedger): string {
  return createHash("sha256").update(JSON.stringify(ledger)).digest("hex");
}
