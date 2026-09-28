import type { DatabaseSync } from "node:sqlite";
import { PAYLOAD_DESCRIPTORS, type PayloadDescriptor } from "./descriptors.js";

export interface CanonicalPayloadRecord {
  readonly descriptor: PayloadDescriptor;
  readonly sourceKey: string;
  readonly key: Readonly<Record<string, unknown>>;
  readonly encoded: Uint8Array | string;
  readonly payloadVersion: number;
  readonly bytes: number;
}

export interface CanonicalPayloadDecodeResult extends CanonicalPayloadRecord {
  readonly value: unknown;
}

export interface PayloadDescriptorCoverage {
  readonly unregisteredPayloadColumns: readonly string[];
  readonly unregisteredNamespaces: readonly string[];
  readonly invalidDescriptors: readonly string[];
}

/**
 * Lazily iterates canonical payload bytes without opening a write transaction.
 * Supplying descriptors supports focused consumers and tests; the default is
 * the complete canonical registry.
 */
export function* iterateCanonicalPayloadRecords(
  database: DatabaseSync,
  descriptors: readonly PayloadDescriptor[] = canonicalDescriptors(),
): IterableIterator<CanonicalPayloadRecord> {
  for (const descriptor of descriptors) {
    if (descriptor.location.database !== "canonical") continue;
    if (
      descriptor.optional &&
      !tableExists(database, descriptor.location.table)
    )
      continue;
    yield* iterateDescriptorRows(database, descriptor);
  }
}

export function* decodeCanonicalPayloadRecords(
  database: DatabaseSync,
  descriptors: readonly PayloadDescriptor[] = canonicalDescriptors(),
): IterableIterator<CanonicalPayloadDecodeResult> {
  for (const record of iterateCanonicalPayloadRecords(database, descriptors)) {
    yield {
      ...record,
      value: record.descriptor.codec.decode(
        record.encoded,
        record.payloadVersion,
      ),
    };
  }
}

/**
 * Checks the live canonical schema and stored namespace values against the
 * registry. Payload columns are non-null BLOB `data`/`outcome` columns; nullable
 * quarantine originals are deliberately excluded.
 */
export function inspectPayloadDescriptorCoverage(
  database: DatabaseSync,
  descriptors: readonly PayloadDescriptor[] = canonicalDescriptors(),
): PayloadDescriptorCoverage {
  const canonical = descriptors.filter(
    ({ location }) => location.database === "canonical",
  );
  const tables = readTableColumns(database);
  const coveredColumns = new Set(
    canonical.map(({ location }) => `${location.table}.${location.column}`),
  );
  const payloadColumns = [...tables.entries()].flatMap(([table, columns]) =>
    columns
      .filter(
        (column) =>
          (column.name === "data" || column.name === "outcome") &&
          column.type.toUpperCase() === "BLOB" &&
          column.notnull === 1,
      )
      .map((column) => `${table}.${column.name}`),
  );

  const invalidDescriptors = canonical.flatMap((descriptor) => {
    const columns = tables.get(descriptor.location.table);
    if (!columns)
      return descriptor.optional ? [] : [`${descriptor.id}: missing table`];
    const names = new Set(columns.map(({ name }) => name));
    const referenced = [
      descriptor.location.column,
      ...descriptor.keyColumns,
      ...(descriptor.version.kind === "column"
        ? [descriptor.version.column]
        : []),
      ...(descriptor.location.namespace ? ["namespace"] : []),
      ...(descriptor.location.discriminator
        ? [descriptor.location.discriminator.column]
        : []),
    ];
    const missing = referenced.filter((column) => !names.has(column));
    return missing.length
      ? [`${descriptor.id}: missing columns ${missing.join(", ")}`]
      : [];
  });

  const namespaces = tables.has("domain_documents")
    ? (
        database
          .prepare(
            "SELECT DISTINCT namespace FROM domain_documents ORDER BY namespace",
          )
          .all() as unknown as Array<{ namespace: unknown }>
      ).flatMap(({ namespace }) =>
        typeof namespace === "string" ? [namespace] : [],
      )
    : [];
  const coveredNamespaces = new Set(
    canonical.flatMap(({ location }) =>
      location.namespace ? [location.namespace] : [],
    ),
  );

  return {
    unregisteredPayloadColumns: payloadColumns.filter(
      (column) => !coveredColumns.has(column),
    ),
    unregisteredNamespaces: namespaces.filter(
      (namespace) => !coveredNamespaces.has(namespace),
    ),
    invalidDescriptors,
  };
}

export function unregisteredNamespaceReferences(
  sources: Iterable<string>,
  descriptors: readonly PayloadDescriptor[] = canonicalDescriptors(),
): string[] {
  const covered = new Set(
    descriptors.flatMap(({ location }) =>
      location.namespace ? [location.namespace] : [],
    ),
  );
  const referenced = new Set<string>();
  for (const source of sources) {
    for (const pattern of NAMESPACE_REFERENCE_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const namespace = match[1];
        if (namespace) referenced.add(namespace);
      }
    }
  }
  return [...referenced].filter((namespace) => !covered.has(namespace)).sort();
}

export function assertNamespaceReferencesCovered(
  sources: Iterable<string>,
  descriptors: readonly PayloadDescriptor[] = canonicalDescriptors(),
): void {
  const missing = unregisteredNamespaceReferences(sources, descriptors);
  if (missing.length > 0) {
    throw new Error(
      `Payload descriptors are missing namespace references: ${missing.join(", ")}.`,
    );
  }
}

export function assertPayloadDescriptorCoverage(
  database: DatabaseSync,
  descriptors: readonly PayloadDescriptor[] = canonicalDescriptors(),
): void {
  const coverage = inspectPayloadDescriptorCoverage(database, descriptors);
  const issues = [
    ...coverage.unregisteredPayloadColumns.map(
      (column) => `unregistered payload column ${column}`,
    ),
    ...coverage.unregisteredNamespaces.map(
      (namespace) => `unregistered domain namespace ${namespace}`,
    ),
    ...coverage.invalidDescriptors,
  ];
  if (issues.length > 0) {
    throw new Error(`Payload descriptor coverage failed: ${issues.join("; ")}`);
  }
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(
    database
      .prepare(
        `SELECT 1 FROM sqlite_master
         WHERE type = 'table' AND name = ?`,
      )
      .get(table),
  );
}

const NAMESPACE_REFERENCE_PATTERNS = [
  /\bnamespace\s*:\s*["']([^"']+)["']/g,
  /\b(?:read|list|delete)Document(?:s)?(?:<[^>]*>)?\s*\(\s*["']([^"']+)["']/g,
  /\b[A-Z][A-Z_]*NAMESPACE\s*=\s*["']([^"']+)["']/g,
  /\bnamespace\s*=\s*["']([^"']+)["']/g,
] as const;

function* iterateDescriptorRows(
  database: DatabaseSync,
  descriptor: PayloadDescriptor,
): IterableIterator<CanonicalPayloadRecord> {
  const { location } = descriptor;
  const selected = [
    ...descriptor.keyColumns.map(
      (column, index) => `${quoteIdentifier(column)} AS key_${index}`,
    ),
    `${quoteIdentifier(location.column)} AS encoded_payload`,
    descriptor.version.kind === "column"
      ? `${quoteIdentifier(descriptor.version.column)} AS encoded_version`
      : `${descriptor.version.version} AS encoded_version`,
  ];
  const conditions: string[] = [];
  const parameters: (string | number)[] = [];
  if (location.namespace) {
    conditions.push(`${quoteIdentifier("namespace")} = ?`);
    parameters.push(location.namespace);
  }
  if (location.discriminator) {
    conditions.push(`${quoteIdentifier(location.discriminator.column)} = ?`);
    parameters.push(location.discriminator.value);
  }
  const sql = `SELECT ${selected.join(", ")} FROM ${quoteIdentifier(location.table)}${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY ${descriptor.keyColumns.map(quoteIdentifier).join(", ")}`;

  for (const value of database.prepare(sql).iterate(...parameters)) {
    const row = value as Record<string, unknown>;
    const encoded = row.encoded_payload;
    const payloadVersion = row.encoded_version;
    if (!(typeof encoded === "string" || encoded instanceof Uint8Array)) {
      throw new Error(`${descriptor.id} contains a non-bytes payload.`);
    }
    if (!Number.isSafeInteger(payloadVersion) || Number(payloadVersion) < 1) {
      throw new Error(`${descriptor.id} contains an invalid payload version.`);
    }
    const key = Object.fromEntries(
      descriptor.keyColumns.map((column, index) => [
        column,
        row[`key_${index}`],
      ]),
    );
    yield {
      descriptor,
      sourceKey: descriptor.keyColumns
        .map((column) => String(key[column]))
        .join("/"),
      key,
      encoded,
      payloadVersion: Number(payloadVersion),
      bytes:
        typeof encoded === "string"
          ? Buffer.byteLength(encoded)
          : encoded.byteLength,
    };
  }
}

interface TableColumn {
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
}

function readTableColumns(database: DatabaseSync): Map<string, TableColumn[]> {
  const rows = database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as unknown as Array<{ name: string }>;
  return new Map(
    rows.map(({ name }) => [
      name,
      database
        .prepare(`PRAGMA table_info(${quoteIdentifier(name)})`)
        .all() as unknown as TableColumn[],
    ]),
  );
}

function canonicalDescriptors(): PayloadDescriptor[] {
  return PAYLOAD_DESCRIPTORS.filter(
    ({ location }) => location.database === "canonical",
  );
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
