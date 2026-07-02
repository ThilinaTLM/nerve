export function sandboxCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sandboxSha256Digest(value: unknown): string {
  // Transport-neutral stable digest helper for schemas/tests. Runtime packages use
  // Node crypto for true SHA-256 when cryptographic strength is required.
  return `sha256:${stableHexDigest(sandboxCanonicalJson(value))}`;
}

export const sandboxCommandParamsHash = sandboxSha256Digest;
export const sandboxConfigDigestStable = sandboxSha256Digest;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(
    value as Record<string, unknown>,
  ).sort(([a], [b]) => a.localeCompare(b))) {
    if (entry !== undefined) result[key] = canonicalize(entry);
  }
  return result;
}

function stableHexDigest(input: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    a ^= input.charCodeAt(i);
    a = Math.imul(a, 0x01000193) >>> 0;
    b = (Math.imul(b ^ input.charCodeAt(i), 0x85ebca6b) + a) >>> 0;
  }
  const part = (n: number) => n.toString(16).padStart(8, "0");
  return `${part(a)}${part(b)}${part(a ^ b)}${part(Math.imul(a, b) >>> 0)}${part((a + b) >>> 0)}${part((a * 31 + b) >>> 0)}${part((b * 31 + a) >>> 0)}${part((a ^ 0xa5a5a5a5) >>> 0)}`;
}
