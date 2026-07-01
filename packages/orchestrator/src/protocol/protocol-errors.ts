import type { NerveErrorCode, ProtocolErrorData } from "@nervekit/shared";

const SECRET_KEY_PATTERN =
  /authorization|cookie|token|apikey|api_key|password|passwd|secret|credential|private_key|private-key/i;
const MAX_DETAIL_STRING = 1_000;

export function redactProtocolValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[MaxDepth]";
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && value.length > MAX_DETAIL_STRING) {
      return `${value.slice(0, MAX_DETAIL_STRING)}…`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((item) => redactProtocolValue(item, depth + 1));
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SECRET_KEY_PATTERN.test(key)
      ? "[REDACTED]"
      : redactProtocolValue(child, depth + 1);
  }
  return output;
}

export function protocolErrorData(
  code: NerveErrorCode,
  message: string,
  options: Partial<ProtocolErrorData> = {},
): ProtocolErrorData {
  return {
    code,
    message,
    retryable: options.retryable ?? false,
    close: options.close,
    details: options.details
      ? (redactProtocolValue(options.details) as Record<string, unknown>)
      : undefined,
    recovery: options.recovery,
  };
}
