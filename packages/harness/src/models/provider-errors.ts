import {
  isRetryableAssistantError,
  type AssistantMessage,
} from "@earendil-works/pi-ai";

/**
 * Nerve-only permanent failures checked before pi-ai: explicit markers, generic
 * usage limits, and context overflow, which compaction handles instead of retry.
 */
const PERMANENT_PROVIDER_ERROR =
  /NON_RETRYABLE|usage limit|context.?length|context.?window|maximum context|too many tokens/i;

/** Nerve-only transient failures that pi-ai's classifier does not cover. */
const TRANSIENT_PROVIDER_ERROR =
  /RETRYABLE|error occurred while processing your request/i;

/**
 * Classifies known provider failures that are safe to retry automatically.
 * pi-ai owns the shared provider list; Nerve only adds its own overrides.
 */
export function isRetryableProviderError(message?: string): boolean {
  if (!message || PERMANENT_PROVIDER_ERROR.test(message)) return false;
  const failure = {
    stopReason: "error",
    errorMessage: message,
  } as AssistantMessage;
  return (
    isRetryableAssistantError(failure) || TRANSIENT_PROVIDER_ERROR.test(message)
  );
}
