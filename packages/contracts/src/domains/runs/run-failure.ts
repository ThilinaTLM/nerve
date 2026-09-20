import { z } from "zod";

/** Stable, presentation-neutral classification for failures that stop a run. */
export const runFailureCategorySchema = z.enum([
  "rate_limit",
  "authentication",
  "connection",
  "provider",
  "harness",
  "unknown",
]);
export type RunFailureCategory = z.infer<typeof runFailureCategorySchema>;

export type RunFailureSource = "provider" | "harness" | "unknown";

export type NormalizedRunFailure = {
  message: string;
  category: RunFailureCategory;
  httpStatus?: number;
};

const RATE_LIMIT_PATTERN =
  /rate.?limit|too many requests|usage limit|insufficient_quota|quota exceeded|available balance|out of budget/i;
const AUTHENTICATION_PATTERN =
  /authentication|unauthorized|forbidden|invalid (?:api )?key|missing (?:api )?key|auth(?:entication)? failed/i;
const CONNECTION_PATTERN =
  /network.?error|connection.?error|connection.?refused|connection.?lost|fetch failed|upstream.?connect|socket hang up|reset before headers|websocket.?closed|websocket.?error|http2 request did not get a response|timed? out|timeout|terminated|stream ended/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function statusFrom(
  value: Record<string, unknown> | undefined,
): number | undefined {
  const candidate = value?.status ?? value?.statusCode;
  return typeof candidate === "number" && candidate >= 100 && candidate <= 599
    ? Math.trunc(candidate)
    : undefined;
}

function stringFrom(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : undefined;
}

function structuredFailure(raw: string): {
  message?: string;
  type?: string;
  httpStatus?: number;
  parsed: boolean;
} {
  const statusPrefix = raw.match(/^\s*(\d{3})(?:\s+|$)/);
  const prefixedStatus = statusPrefix ? Number(statusPrefix[1]) : undefined;
  const jsonText = statusPrefix
    ? raw.slice(statusPrefix[0].length).trim()
    : raw.trim();
  if (!jsonText.startsWith("{")) {
    return { httpStatus: prefixedStatus, parsed: false };
  }
  try {
    const outer = record(JSON.parse(jsonText));
    const inner = record(outer?.error);
    return {
      message:
        stringFrom(inner, "message") ??
        stringFrom(outer, "message") ??
        stringFrom(inner, "detail") ??
        stringFrom(outer, "detail"),
      type:
        stringFrom(inner, "type") ??
        stringFrom(inner, "code") ??
        stringFrom(outer, "type") ??
        stringFrom(outer, "code"),
      httpStatus: prefixedStatus ?? statusFrom(outer) ?? statusFrom(inner),
      parsed: true,
    };
  } catch {
    return { httpStatus: prefixedStatus, parsed: false };
  }
}

/**
 * Converts provider/runtime failure text into a concise durable message and a
 * stable category. Structured provider payloads are reduced to their public
 * message rather than persisted as raw JSON.
 */
export function normalizeRunFailure(
  value: unknown,
  source: RunFailureSource = "unknown",
): NormalizedRunFailure {
  const raw = (
    value instanceof Error ? value.message : String(value ?? "")
  ).trim();
  const fallback = raw || "Run failed.";
  const structured = structuredFailure(fallback);
  const message = structured.message ?? fallback;
  const evidence = `${structured.type ?? ""} ${message}`;
  const httpStatus = structured.httpStatus;

  let category: RunFailureCategory;
  if (httpStatus === 429 || RATE_LIMIT_PATTERN.test(evidence)) {
    category = "rate_limit";
  } else if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    AUTHENTICATION_PATTERN.test(evidence)
  ) {
    category = "authentication";
  } else if (CONNECTION_PATTERN.test(evidence)) {
    category = "connection";
  } else if (source === "provider" || structured.parsed || httpStatus) {
    category = "provider";
  } else if (source === "harness") {
    category = "harness";
  } else {
    category = "unknown";
  }

  return {
    message,
    category,
    ...(httpStatus ? { httpStatus } : {}),
  };
}
