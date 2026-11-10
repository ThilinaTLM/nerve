/** Forgiving argument parsing shared by SDK methods. */

export function objectArg(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("options must be an object.");
  }
  return value as Record<string, unknown>;
}

export function nonEmptyString(value: unknown, name: string): string {
  const text =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!text) throw new Error(`${name} must be a non-empty string.`);
  return text;
}

/**
 * Accepts `("KEY", { ...options })` or `({ key | alias, ...options }, { ...options })`.
 * Returns the identifier and the merged options.
 */
export function identifierArgs(
  args: unknown[],
  aliases: readonly string[],
  name: string,
): { value: string; options: Record<string, unknown> } {
  const [first, second] = args;
  if (typeof first === "string" || typeof first === "number") {
    return { value: nonEmptyString(first, name), options: objectArg(second) };
  }
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const record = first as Record<string, unknown>;
    const alias = aliases.find((candidate) => record[candidate] !== undefined);
    if (alias) {
      const { [alias]: value, ...rest } = record;
      return {
        value: nonEmptyString(value, name),
        options: { ...rest, ...objectArg(second) },
      };
    }
  }
  throw new Error(
    `${name} must be a non-empty string (pass it directly or as { ${aliases[0]} }).`,
  );
}

export function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
