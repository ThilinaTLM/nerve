import type { DatabaseSync } from "node:sqlite";
import {
  PAYLOAD_DESCRIPTORS,
  type PayloadDescriptor,
} from "../../persistence/payloads/descriptors.js";
import type { StorageSweepDescriptor, SweepRecord } from "./sweep.js";

export function canonicalPayloadSweepDescriptors(): StorageSweepDescriptor[] {
  return PAYLOAD_DESCRIPTORS.filter(
    (descriptor) => descriptor.location.database === "canonical",
  ).map(toSweepDescriptor);
}

function toSweepDescriptor(
  descriptor: PayloadDescriptor,
): StorageSweepDescriptor {
  return {
    id: descriptor.id,
    recordClass: descriptor.recordClass,
    quarantineUnit: descriptor.quarantineUnit,
    read(database) {
      return readRows(database, descriptor);
    },
    decode(record) {
      const wrapped = record.value as {
        encoded: Uint8Array | string;
        version: number;
      };
      return descriptor.codec.decode(wrapped.encoded, wrapped.version);
    },
  };
}

function readRows(
  database: DatabaseSync,
  descriptor: PayloadDescriptor,
): SweepRecord[] {
  const { location } = descriptor;
  const selected = [
    ...descriptor.keyColumns.map(
      (column, index) => `${column} AS key_${index}`,
    ),
    `${location.column} AS encoded`,
    descriptor.version.kind === "column"
      ? `${descriptor.version.column} AS payload_version`
      : `${descriptor.version.version} AS payload_version`,
  ];
  const conditions: string[] = [];
  const parameters: string[] = [];
  if (location.namespace) {
    conditions.push("namespace = ?");
    parameters.push(location.namespace);
  }
  if (location.discriminator) {
    conditions.push(`${location.discriminator.column} = ?`);
    parameters.push(location.discriminator.value);
  }
  const sql = `SELECT ${selected.join(", ")} FROM ${location.table}${
    conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""
  } ORDER BY ${descriptor.keyColumns.join(", ")}`;
  const rows = database.prepare(sql).all(...parameters) as unknown as Array<
    Record<string, unknown> & {
      encoded: Uint8Array | string;
      payload_version: number;
    }
  >;
  return rows.map((row) => ({
    sourceKey: descriptor.keyColumns
      .map((_column, index) => String(row[`key_${index}`]))
      .join("/"),
    bytes:
      typeof row.encoded === "string"
        ? Buffer.byteLength(row.encoded)
        : row.encoded.byteLength,
    value: { encoded: row.encoded, version: row.payload_version },
  }));
}
