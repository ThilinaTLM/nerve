export type LooseObjectV1 = Record<string, unknown>;

export function looseObjectV1(value: unknown, label = "value"): LooseObjectV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as LooseObjectV1;
}

export function stringV1(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

export function optionalStringV1(
  value: unknown,
  label: string,
): string | undefined {
  return value === undefined ? undefined : stringV1(value, label);
}

export function nonnegativeIntegerV1(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a nonnegative safe integer.`);
  }
  return value as number;
}

export function booleanV1(value: unknown, label: string): boolean {
  if (typeof value !== "boolean")
    throw new Error(`${label} must be a boolean.`);
  return value;
}
