import { createHash } from "node:crypto";

/** Stable semantic fingerprint; callers omit transport IDs and retry-only CAS. */
export function conversationCommandFingerprint(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value, new Set()))
    .digest("hex")}`;
}

function canonicalJson(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    assertAcyclic(value, ancestors);
    const encoded = `[${value
      .map((item) =>
        item === undefined ? "null" : canonicalJson(item, ancestors),
      )
      .join(",")}]`;
    ancestors.delete(value);
    return encoded;
  }
  if (typeof value === "object") {
    assertAcyclic(value, ancestors);
    const encoded = `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalJson(item, ancestors)}`,
      )
      .join(",")}}`;
    ancestors.delete(value);
    return encoded;
  }
  if (typeof value === "bigint" || typeof value === "symbol") {
    throw new TypeError("Command fingerprints support JSON values only.");
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new TypeError("Command fingerprints support JSON values only.");
  }
  return encoded;
}

function assertAcyclic(value: object, ancestors: Set<object>): void {
  if (ancestors.has(value)) {
    throw new TypeError("Command fingerprint input must be acyclic.");
  }
  ancestors.add(value);
}
