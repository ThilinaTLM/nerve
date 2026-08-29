const PERMANENT_PROVIDER_ERROR =
  /NON_RETRYABLE|GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|usage limit|available balance|insufficient_quota|out of budget|quota exceeded|billing|context.?length|context.?window|maximum context|too many tokens/i;

const TRANSIENT_PROVIDER_ERROR =
  /RETRYABLE|overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|error occurred while processing your request|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|stream ended before message_stop|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i;

/** Classifies known provider failures that are safe to retry automatically. */
export function isRetryableProviderError(message?: string): boolean {
  if (!message || PERMANENT_PROVIDER_ERROR.test(message)) return false;
  return TRANSIENT_PROVIDER_ERROR.test(message);
}
