import type { ToolDefinition } from "./contracts.js";

type SchemaNode = {
  type?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode;
  minimum?: number;
  maximum?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Conversions every executor already tolerates, applied against the model-facing schema
 * (which stays strict): `null` for an optional field means "absent", and bounded numbers
 * of local tools are clamped (their executors clamp rather than reject).
 */
function conform(
  schema: SchemaNode | undefined,
  value: unknown,
  clamp: boolean,
): unknown {
  if (!schema) return value;
  if (schema.type === "array" && Array.isArray(value))
    return value.map((item) => conform(schema.items, item, clamp));
  if (
    (schema.type === "number" || schema.type === "integer") &&
    clamp &&
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    let next = schema.type === "integer" ? Math.floor(value) : value;
    if (schema.minimum !== undefined) next = Math.max(schema.minimum, next);
    if (schema.maximum !== undefined) next = Math.min(schema.maximum, next);
    return next;
  }
  if (schema.type !== "object" || !schema.properties || !isRecord(value))
    return value;
  const required = new Set(schema.required ?? []);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null && schema.properties[key] && !required.has(key))
      continue;
    output[key] = conform(schema.properties[key], entry, clamp);
  }
  return output;
}

/**
 * Apply a tool's one canonical pre-validation argument normalization step. The result
 * satisfies the tool's schema exactly when the tool would accept the call. Idempotent,
 * never mutates `raw`.
 */
export function normalizeToolArguments(
  definition: ToolDefinition,
  raw: unknown,
): Record<string, unknown> {
  const specific = definition.normalizeArguments
    ? definition.normalizeArguments(raw)
    : raw;
  return conform(
    definition.parameters,
    specific,
    definition.executionKind === "local",
  ) as Record<string, unknown>;
}
