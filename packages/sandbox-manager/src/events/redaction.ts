const sensitive =
  /(authorization|cookie|api[_-]?key|token|secret|password|private[_-]?key|credential|value)/i;
export function redactManagerEvent<T>(value: T): T {
  return redact(value) as T;
}
function isScalar(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

function redact(value: unknown): unknown {
  if (typeof value === "string")
    return value.replace(
      /(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,})/g,
      "[REDACTED]",
    );
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const shouldRedact = sensitive.test(key);
    out[key] = shouldRedact && isScalar(entry) ? "[REDACTED]" : redact(entry);
  }
  return out;
}
