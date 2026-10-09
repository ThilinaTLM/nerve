export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Applies a partial upgraded shape without discarding fields the upgrader does
 * not know about. Objects are merged recursively; arrays and scalar values are
 * replaced. Neither input is mutated.
 */
export function mergePreservingUnknown(
  original: unknown,
  upgraded: unknown,
): unknown {
  if (!isJsonObject(original) || !isJsonObject(upgraded)) {
    return structuredClone(upgraded);
  }

  const result: JsonObject = { ...structuredClone(original) };
  for (const [key, value] of Object.entries(upgraded)) {
    result[key] = mergePreservingUnknown(original[key], value);
  }
  return result;
}

/**
 * Recombines a read-schema projection with its raw input. Unlike upgrader
 * merging, arrays retain their projected length while recursively preserving
 * unknown fields on corresponding object elements.
 */
export function mergeParsedWithRaw(raw: unknown, parsed: unknown): unknown {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    return parsed.map((value, index) => mergeParsedWithRaw(raw[index], value));
  }
  if (!isJsonObject(raw) || !isJsonObject(parsed)) {
    return structuredClone(parsed);
  }

  const result: JsonObject = { ...structuredClone(raw) };
  for (const [key, value] of Object.entries(parsed)) {
    result[key] = mergeParsedWithRaw(raw[key], value);
  }
  return result;
}
