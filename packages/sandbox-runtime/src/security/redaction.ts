const sensitiveKeyPattern =
  /(authorization|cookie|set-cookie|api[_-]?key|token|secret|password|passphrase|private[_-]?key|credential)/i;
const tokenShapePattern =
  /(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/g;

export type RedactorOptions = { secrets?: string[]; patterns?: string[] };

export class Redactor {
  private readonly secretValues: string[];
  private readonly regexes: RegExp[];

  constructor(options: RedactorOptions = {}) {
    this.secretValues = (options.secrets ?? [])
      .filter((value) => value.length > 0)
      .sort((a, b) => b.length - a.length);
    this.regexes = [
      tokenShapePattern,
      ...(options.patterns ?? []).map((pattern) => new RegExp(pattern, "g")),
    ];
  }

  addSecret(value: string | undefined): void {
    if (!value || this.secretValues.includes(value)) return;
    this.secretValues.push(value);
    this.secretValues.sort((a, b) => b.length - a.length);
  }

  redactText(text: string): string {
    let result = text;
    for (const secret of this.secretValues)
      result = result.split(secret).join("[REDACTED]");
    for (const regex of this.regexes)
      result = result.replace(regex, "[REDACTED]");
    return result;
  }

  redact<T>(value: T): T {
    return redactValue(value, this) as T;
  }
}

export function redactValue(
  value: unknown,
  redactor = new Redactor(),
): unknown {
  if (typeof value === "string") return redactor.redactText(value);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((entry) => redactValue(entry, redactor));
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] =
      sensitiveKeyPattern.test(key) && key !== "credentialType"
        ? "[REDACTED]"
        : redactValue(entry, redactor);
  }
  return result;
}
