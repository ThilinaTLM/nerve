export type SqlRow = Record<string, unknown>;

export function decodeSqlRow(value: unknown, context: string): SqlRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid SQLite row for ${context}.`);
  }
  return value as SqlRow;
}

export function decodeSqlRows<T>(
  values: readonly unknown[],
  context: string,
  decodeRow: (row: SqlRow, index: number) => T,
): T[] {
  return values.map((value, index) =>
    decodeRow(decodeSqlRow(value, `${context}[${index}]`), index),
  );
}

export function sqlString(row: SqlRow, field: string, context: string): string {
  const value = row[field];
  if (typeof value !== "string") invalidField(field, context, "string");
  return value;
}

export function sqlInteger(
  row: SqlRow,
  field: string,
  context: string,
): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    invalidField(field, context, "safe integer");
  }
  return value;
}

export function sqlNullableInteger(
  row: SqlRow,
  field: string,
  context: string,
): number | null {
  if (row[field] === null) return null;
  return sqlInteger(row, field, context);
}

export function sqlBytes(
  row: SqlRow,
  field: string,
  context: string,
): Uint8Array | string {
  const value = row[field];
  if (typeof value !== "string" && !(value instanceof Uint8Array)) {
    invalidField(field, context, "text or bytes");
  }
  return value;
}

export function sqlEnum<const T extends string>(
  row: SqlRow,
  field: string,
  values: readonly T[],
  context: string,
): T {
  const value = sqlString(row, field, context);
  if (!values.includes(value as T)) {
    throw new Error(`Invalid SQLite field ${context}.${field}: unknown value.`);
  }
  return value as T;
}

function invalidField(field: string, context: string, expected: string): never {
  throw new Error(
    `Invalid SQLite field ${context}.${field}: expected ${expected}.`,
  );
}
