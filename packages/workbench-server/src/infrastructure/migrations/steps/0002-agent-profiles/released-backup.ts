import assert from "node:assert/strict";
import { z } from "zod";
import { dirname } from "node:path";
import { jsonBytes, sha256 } from "./released-format.js";
export const databaseBackupReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    phase: z.enum(["planned", "ready"]),
    temporary: z.string().min(1),
    target: z.string().min(1),
    planDigest: z.string().regex(/^[a-f0-9]{64}$/),
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.phase !== "ready" || value.digest !== undefined,
    "Ready backup requires a digest",
  );
export interface DatabaseBackupReceipt {
  schemaVersion: 1;
  phase: "planned" | "ready";
  temporary: string;
  target: string;
  planDigest: string;
  digest?: string;
}
export interface DatabaseBackupIO {
  read(path: string): string | Uint8Array | undefined;
  write(path: string, bytes: string): void;
  remove(path: string): void;
  /** SQLite online backup in production, plain bytes in fake tests. */
  snapshot(temporary: string): Promise<void>;
  sync(temporary: string): void;
  install(temporary: string, target: string): void;
}
function receipt(
  io: DatabaseBackupIO,
  path: string,
): DatabaseBackupReceipt | undefined {
  const bytes = io.read(path);
  if (bytes === undefined) return undefined;
  return databaseBackupReceiptSchema.parse(
    JSON.parse(
      typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8"),
    ),
  );
}
export function verifyDatabaseBackup(
  io: DatabaseBackupIO,
  receiptPath: string,
  target: string,
  planDigest: string,
): void {
  const saved = receipt(io, receiptPath);
  assert(
    saved?.phase === "ready" &&
      saved.target === target &&
      saved.planDigest === planDigest,
    "Database backup is not bound to this conversion plan",
  );
  const bytes = io.read(target);
  assert(
    bytes !== undefined && sha256(bytes) === saved.digest,
    "Original database backup changed",
  );
}
/** Intent before copy, ready+digest before rename. Every crash boundary has
 * ownership evidence: partial own temporaries can be recreated, unowned finals
 * never overwritten, completed snapshots are reused instead of copied again. */
export async function preserveDatabaseBackup(
  io: DatabaseBackupIO,
  input: {
    receiptPath: string;
    target: string;
    planDigest: string;
    temporary(): string;
  },
): Promise<void> {
  let saved = receipt(io, input.receiptPath);
  if (!saved) {
    assert(
      io.read(input.target) === undefined,
      "Unowned database backup collision",
    );
    saved = {
      schemaVersion: 1,
      phase: "planned",
      temporary: input.temporary(),
      target: input.target,
      planDigest: input.planDigest,
    };
    io.write(input.receiptPath, jsonBytes(saved));
  }
  assert(
    saved.target === input.target && saved.planDigest === input.planDigest,
    "Database backup belongs to another plan",
  );
  assert(
    dirname(saved.temporary) === dirname(input.target) &&
      saved.temporary.startsWith(input.target + ".") &&
      saved.temporary.endsWith(".tmp"),
    "Unsafe database backup temporary",
  );
  if (saved.phase === "planned") {
    assert(
      io.read(input.target) === undefined,
      "Backup appeared before ready receipt",
    );
    io.remove(saved.temporary);
    await io.snapshot(saved.temporary);
    io.sync(saved.temporary);
    const bytes = io.read(saved.temporary);
    assert(bytes !== undefined, "Database snapshot missing");
    saved = { ...saved, phase: "ready", digest: sha256(bytes) };
    io.write(input.receiptPath, jsonBytes(saved));
  }
  if (io.read(input.target) === undefined) {
    const bytes = io.read(saved.temporary);
    assert(
      bytes !== undefined && sha256(bytes) === saved.digest,
      "Interrupted database snapshot changed",
    );
    io.install(saved.temporary, input.target);
  }
  verifyDatabaseBackup(io, input.receiptPath, input.target, input.planDigest);
}
