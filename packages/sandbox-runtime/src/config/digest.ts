import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sandboxConfigDigest(config: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(config)).digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  const result: Record<string, unknown> = {};
  for (const [key, entryValue] of entries) {
    if (entryValue === undefined) continue;
    result[key] = canonicalize(entryValue);
  }
  return result;
}
