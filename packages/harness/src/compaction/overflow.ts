import type { AssistantMessage } from "@earendil-works/pi-ai";

const OVERFLOW_PATTERNS = [
  /prompt is too long/i,
  /request_too_large/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /exceeds (?:the )?(?:model'?s )?maximum context length of [\d,]+ tokens?/i,
  /input token count.*exceeds the maximum/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /maximum context length is [\d,]+ tokens/i,
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i,
  /input \([\d,]+ tokens\) is longer than the model'?s context length \([\d,]+ tokens\)/i,
  /exceeds the limit of [\d,]+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /too large for model with [\d,]+ maximum context length/i,
  /model_context_window_exceeded/i,
  /prompt too long; exceeded (?:max )?context length/i,
  /context[_ ]length[_ ]exceeded/i,
  /too many tokens/i,
  /token limit exceeded/i,
  /^4(?:00|13)\s*(?:status code)?\s*\(no body\)/i,
];

const NON_OVERFLOW_PATTERNS = [
  /^(Throttling error|Service unavailable):/i,
  /rate limit/i,
  /too many requests/i,
  /throttling/i,
  /service unavailable/i,
];

export function isContextOverflowAssistantMessage(
  message: AssistantMessage,
  contextWindow?: number,
): boolean {
  if (message.stopReason === "error" && message.errorMessage) {
    const isNonOverflow = NON_OVERFLOW_PATTERNS.some((pattern) =>
      pattern.test(message.errorMessage ?? ""),
    );
    if (
      !isNonOverflow &&
      OVERFLOW_PATTERNS.some((pattern) =>
        pattern.test(message.errorMessage ?? ""),
      )
    ) {
      return true;
    }
  }

  if (contextWindow && contextWindow > 0) {
    const inputTokens = message.usage.input + message.usage.cacheRead;
    if (message.stopReason === "stop" && inputTokens > contextWindow) {
      return true;
    }
    if (
      message.stopReason === "length" &&
      message.usage.output === 0 &&
      inputTokens >= contextWindow * 0.99
    ) {
      return true;
    }
  }

  return false;
}
