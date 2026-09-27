import { createHash } from "node:crypto";

export type JsonPrimitiveV1 = string | number | boolean | null;
export type JsonValueV1 =
  | JsonPrimitiveV1
  | JsonValueV1[]
  | { [key: string]: JsonValueV1 };
export type JsonObjectV1 = { [key: string]: JsonValueV1 };

export function isJsonObjectV1(value: unknown): value is JsonObjectV1 {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ArrayBuffer.isView(value)
  )
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValueV1(
  value: unknown,
  seen: Set<object>,
  label: string,
): asserts value is JsonValueV1 {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error(`${label} contains a non-finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error(`${label} contains a cycle.`);
    seen.add(value);
    value.forEach((item, index) =>
      assertJsonValueV1(item, seen, `${label}[${index}]`),
    );
    seen.delete(value);
    return;
  }
  if (!isJsonObjectV1(value))
    throw new Error(`${label} contains a non-JSON value.`);
  if (seen.has(value)) throw new Error(`${label} contains a cycle.`);
  seen.add(value);
  for (const [key, item] of Object.entries(value))
    assertJsonValueV1(item, seen, `${label}.${key}`);
  seen.delete(value);
}

export function parseJsonObjectV1(value: unknown): JsonObjectV1 {
  if (isJsonObjectV1(value)) {
    assertJsonValueV1(value, new Set(), "JSON object");
    return value;
  }
  if (typeof value !== "string" && !(value instanceof Uint8Array))
    throw new Error("Expected encoded JSON or a JSON object.");
  const text =
    typeof value === "string"
      ? value
      : new TextDecoder("utf-8", { fatal: true }).decode(value);
  const parsed: unknown = JSON.parse(text);
  if (!isJsonObjectV1(parsed)) throw new Error("Expected a JSON object.");
  assertJsonValueV1(parsed, new Set(), "JSON object");
  return parsed;
}

export function encodeJsonV1(value: JsonValueV1): Uint8Array {
  assertJsonValueV1(value, new Set(), "JSON value");
  return new TextEncoder().encode(JSON.stringify(value));
}

export function checksumJsonV1(value: JsonValueV1): string {
  return `sha256:${createHash("sha256").update(encodeJsonV1(value)).digest("hex")}`;
}

/** SQL predicate required before calling SQLite JSON functions on a value. */
export function validJsonObjectSqlV1(expression: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*(?:\s+AS\s+TEXT)?$/i.test(expression))
    throw new Error(`Unsafe SQL expression: ${expression}`);
  return `CASE WHEN json_valid(${expression}) THEN json_type(${expression}) END = 'object'`;
}
