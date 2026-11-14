const PUBLIC_REASON_LIMIT = 500;
const SAFE_BODY_LIMIT = 4_000;

export type AtlassianErrorContext = {
  service: "jira" | "confluence";
  method: string;
  path: string;
  status: number;
  body: string;
};

export type SafeAtlassianError = {
  /** `Jira POST /search/jql failed (400 Bad Request): reason`; never the query, the token or more than 4 kB of the body. */
  message: string;
  /** What the service said, bounded and redacted. */
  reason: string | undefined;
};

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Payload Too Large",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

export function safeAtlassianError(
  context: AtlassianErrorContext,
): SafeAtlassianError {
  const serviceName = context.service === "jira" ? "Jira" : "Confluence";
  const method = context.method.toUpperCase();
  const path = safePath(context.path);
  const body = redactAtlassianText(context.body).slice(0, SAFE_BODY_LIMIT);
  const reason = truncate(
    normalizeReason(reasonFromBody(body)),
    PUBLIC_REASON_LIMIT,
  );
  const statusLabel = [context.status, STATUS_TEXT[context.status]]
    .filter(Boolean)
    .join(" ");
  return {
    message: `${serviceName} ${method} ${path} failed (${statusLabel})${reason ? `: ${reason}` : ""}`,
    reason,
  };
}

function reasonFromBody(body: string): string | undefined {
  if (!body.trim()) return undefined;
  try {
    const value = JSON.parse(body) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return normalizeWhitespace(String(value));
    }
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    if (Array.isArray(record.errorMessages)) {
      parts.push(
        ...record.errorMessages.filter(
          (item): item is string => typeof item === "string",
        ),
      );
    }
    if (record.errors && typeof record.errors === "object") {
      for (const [field, message] of Object.entries(
        record.errors as Record<string, unknown>,
      )) {
        if (typeof message === "string") parts.push(`${field}: ${message}`);
      }
    }
    for (const key of ["message", "errorMessage", "error"] as const) {
      if (typeof record[key] === "string") parts.push(record[key]);
    }
    return normalizeWhitespace(parts.join("; ")) || normalizeWhitespace(body);
  } catch {
    return normalizeWhitespace(body);
  }
}

function redactAtlassianText(value: string): string {
  return value
    .replaceAll(/\b(Basic|Bearer)\s+[A-Za-z0-9+/=._~-]+/gi, "$1 [redacted]")
    .replaceAll(
      /("?(?:api[_-]?token|access[_-]?token|authorization|password|secret)"?\s*[:=]\s*")([^"]+)(")/gi,
      "$1[redacted]$3",
    )
    .replaceAll(
      /((?:api[_-]?token|access[_-]?token|authorization|password|secret)\s*[:=]\s*)([^\s,;}]+)/gi,
      "$1[redacted]",
    );
}

function safePath(value: string): string {
  try {
    return new URL(value, "https://example.invalid").pathname;
  } catch {
    return value.split("?", 1)[0] || "/";
  }
}

function normalizeReason(value: string | undefined): string | undefined {
  const normalized = value ? normalizeWhitespace(value) : "";
  return normalized || undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(
  value: string | undefined,
  limit: number,
): string | undefined {
  if (!value || value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}
