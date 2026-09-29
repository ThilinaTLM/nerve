import type { DatabaseSync } from "node:sqlite";

export interface SweepRecord {
  sourceKey: string;
  conversationId?: string;
  bytes: number;
  value: unknown;
}

export interface StorageSweepDescriptor {
  id: string;
  recordClass: "derived" | "user-content";
  quarantineUnit: "record" | "conversation" | "config" | "file";
  read(database: DatabaseSync): Iterable<SweepRecord>;
  validate(record: SweepRecord): void;
}

export interface StorageSweepFailure {
  descriptorId: string;
  sourceKey: string;
  conversationId?: string;
  recordClass: "derived" | "user-content";
  quarantineUnit: "record" | "conversation" | "config" | "file";
  bytes: number;
  reason: string;
}

export interface StorageSweepResult {
  records: number;
  bytes: number;
  failures: StorageSweepFailure[];
}

/** Decode every registered record without writing to the database. */
export function sweepStorageReadability(
  database: DatabaseSync,
  descriptors: readonly StorageSweepDescriptor[],
): StorageSweepResult {
  const result: StorageSweepResult = { records: 0, bytes: 0, failures: [] };
  for (const descriptor of descriptors) {
    for (const record of descriptor.read(database)) {
      result.records += 1;
      result.bytes += record.bytes;
      try {
        descriptor.validate(record);
      } catch (error) {
        result.failures.push({
          descriptorId: descriptor.id,
          sourceKey: record.sourceKey,
          ...(record.conversationId
            ? { conversationId: record.conversationId }
            : {}),
          recordClass: descriptor.recordClass,
          quarantineUnit: descriptor.quarantineUnit,
          bytes: record.bytes,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return result;
}
