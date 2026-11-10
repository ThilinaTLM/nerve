import {
  isContextOverflow,
  type AssistantMessage,
} from "@earendil-works/pi-ai";

/**
 * Throttling that pi-ai only recognizes in Bedrock's formatted prefixes; raw
 * texts such as "ThrottlingException: Too many tokens" are not overflow.
 */
const NON_OVERFLOW_ERROR = /throttling|service unavailable/i;

/**
 * Whether a reply failed or was cut short because the context window overflowed.
 * pi-ai owns the provider error wording and the silent and length-stop cases.
 */
export function isContextOverflowAssistantMessage(
  message: AssistantMessage,
  contextWindow?: number,
): boolean {
  if (
    message.stopReason === "error" &&
    NON_OVERFLOW_ERROR.test(message.errorMessage ?? "")
  )
    return false;
  return isContextOverflow(message, contextWindow);
}
