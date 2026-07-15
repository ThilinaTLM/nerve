const SECRET_KEY_PATTERN =
  /(?:api[_-]?key|access[_-]?token|authorization|auth[_-]?token|bearer|cookie|credential|password|private[_-]?key|secret|session|token)/i;
const TOKEN_VALUE_PATTERN =
  /^(?:bearer\s+\S+|(?:gh[opusr]|sk|pk)_[A-Za-z0-9_-]{16,}|[A-Za-z0-9+/=_-]{40,})$/i;

const MAX_PARTIAL_VALUE_CHARS = 24_000;
const MAX_FALLBACK_ITEMS = 12;
const MAX_FALLBACK_VALUE_CHARS = 240;

export type ToolArgumentSourceInput = {
  /** Exact, final arguments (preferred whenever available). */
  args?: unknown;
  /** Incrementally streamed JSON text. */
  argsText?: string;
  /** Bounded durable transcript arguments used for recovery. */
  argsPreview?: unknown;
};

export type RedactedStructuredEntry = {
  key: string;
  value: string;
  redacted: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return asRecord(value);
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function decodeJsonString(text: string): string {
  try {
    return JSON.parse(`"${text}"`) as string;
  } catch {
    return text
      .replaceAll("\\n", "\n")
      .replaceAll("\\r", "\r")
      .replaceAll("\\t", "\t")
      .replace(/\\(["\\/])/g, "$1");
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function partialStringValues(text: string, key: string): string[] {
  const values: string[] = [];
  const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"`, "g");
  let match = pattern.exec(text);
  while (match) {
    let raw = "";
    let escaped = false;
    let index = match.index + match[0].length;
    while (index < text.length && raw.length < MAX_PARTIAL_VALUE_CHARS) {
      const char = text[index];
      if (!escaped && char === '"') break;
      raw += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      index += 1;
    }
    values.push(decodeJsonString(raw));
    match = pattern.exec(text);
  }
  return values;
}

function partialScalar(
  text: string,
  key: string,
): string | boolean | number | undefined {
  const stringValue = partialStringValues(text, key)[0];
  if (stringValue !== undefined) return stringValue;
  const match = text.match(
    new RegExp(
      `"${escapeRegExp(key)}"\\s*:\\s*(true|false|-?(?:\\d+\\.?\\d*|\\.\\d+))`,
    ),
  );
  if (!match) return undefined;
  if (match[1] === "true") return true;
  if (match[1] === "false") return false;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function formatSafeValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (Array.isArray(value)) {
    const scalars = value.filter(
      (entry) =>
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean",
    );
    if (scalars.length === value.length) return scalars.join(", ");
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return keys.length > 0 ? `fields: ${keys.join(", ")}` : "empty object";
  }
  return undefined;
}

export function isSuspiciousKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function isSuspiciousValue(value: string): boolean {
  return TOKEN_VALUE_PATTERN.test(value.trim());
}

export function redactStructuredValue(key: string, value: unknown): string {
  if (isSuspiciousKey(key)) return "[redacted]";
  const formatted = formatSafeValue(value) ?? "[unavailable]";
  return isSuspiciousValue(formatted) ? "[redacted]" : formatted;
}

export class ToolArgumentSource {
  readonly argsText: string;
  private readonly records: Record<string, unknown>[];

  constructor(input: ToolArgumentSourceInput = {}) {
    this.argsText = input.argsText ?? "";
    const finalArgs = asRecord(input.args);
    const streamedArgs = parseRecord(this.argsText);
    const previewArgs = parseRecord(input.argsPreview);
    this.records = [finalArgs, streamedArgs, previewArgs].filter(
      (record) => Object.keys(record).length > 0,
    );
  }

  value(key: string): unknown {
    for (const record of this.records) {
      if (Object.hasOwn(record, key)) return record[key];
    }
    return partialScalar(this.argsText, key);
  }

  string(key: string): string | undefined {
    const value = this.value(key);
    return typeof value === "string" ? value : undefined;
  }

  strings(key: string): string[] | undefined {
    const value = this.value(key);
    if (Array.isArray(value)) {
      const strings = value.filter(
        (entry): entry is string => typeof entry === "string",
      );
      return strings.length > 0 ? strings : value.length === 0 ? [] : undefined;
    }
    const partial = partialStringValues(this.argsText, key);
    return partial.length > 0 ? partial : undefined;
  }

  number(key: string): number | undefined {
    const value = this.value(key);
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  }

  boolean(key: string): boolean | undefined {
    const value = this.value(key);
    return typeof value === "boolean" ? value : undefined;
  }

  array(key: string): unknown[] | undefined {
    const value = this.value(key);
    return Array.isArray(value) ? value : undefined;
  }

  recordsArray(key: string): Record<string, unknown>[] | undefined {
    const value = this.array(key);
    if (!value) return undefined;
    return value
      .map(asRecord)
      .filter((record) => Object.keys(record).length > 0);
  }

  record(key: string): Record<string, unknown> | undefined {
    const value = this.value(key);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    return value as Record<string, unknown>;
  }

  objectKeys(key: string): string[] {
    return Object.keys(this.record(key) ?? {});
  }

  count(key: string): number | undefined {
    const value = this.array(key);
    return value?.length;
  }

  selectorCount(...keys: string[]): number {
    return keys.reduce((count, key) => {
      const value = this.value(key);
      if (Array.isArray(value)) return count + value.length;
      return value === undefined || value === null || value === ""
        ? count
        : count + 1;
    }, 0);
  }

  /** All string values for repeated nested fields in exact or partial arrays. */
  nestedStrings(key: string): string[] {
    const exact: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const entry of value) visit(entry);
        return;
      }
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (typeof record[key] === "string") exact.push(record[key]);
      for (const child of Object.values(record)) {
        if (child && typeof child === "object") visit(child);
      }
    };
    for (const record of this.records) visit(record);
    return exact.length > 0 ? exact : partialStringValues(this.argsText, key);
  }

  structuredEntries(limit = MAX_FALLBACK_ITEMS): RedactedStructuredEntry[] {
    const record = this.records[0] ?? this.records[1] ?? this.records[2];
    if (record) {
      return Object.entries(record)
        .slice(0, limit)
        .map(([key, value]) => {
          const formatted = redactStructuredValue(key, value);
          return {
            key,
            value:
              formatted.length > MAX_FALLBACK_VALUE_CHARS
                ? `${formatted.slice(0, MAX_FALLBACK_VALUE_CHARS - 1)}…`
                : formatted,
            redacted: formatted === "[redacted]",
          };
        });
    }

    const keys = Array.from(
      this.argsText.matchAll(/"([^"\\]{1,80})"\s*:/g),
      (match) => match[1],
    );
    return [...new Set(keys)].slice(0, limit).map((key) => {
      const value = partialScalar(this.argsText, key);
      const formatted = redactStructuredValue(key, value);
      return { key, value: formatted, redacted: formatted === "[redacted]" };
    });
  }
}

export function toolArgumentSource(
  input: ToolArgumentSourceInput = {},
): ToolArgumentSource {
  return new ToolArgumentSource(input);
}
