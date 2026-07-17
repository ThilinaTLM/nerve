import { RUN_FAILURE_MESSAGE_MAX_LENGTH } from "@nervekit/contracts";
import type { AgentMessage } from "@nervekit/host-runtime/harness";

export interface SandboxExecutionFailure {
  code: string;
  message: string;
  retryable: boolean;
}

/** Flattens an assistant message's text blocks into one string. */
export function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object" && "text" in block
        ? String((block as { text?: unknown }).text ?? "")
        : "",
    )
    .join("");
}

/** Reduces a tool result to its textual content for transcript previews. */
export function previewResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const content = (result as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .map((block) =>
        block && typeof block === "object" && "text" in block
          ? String((block as { text?: unknown }).text ?? "")
          : "",
      )
      .join("");
    return text ? { content: text } : result;
  }
  return result;
}

/** Classifies a provider error message as retryable or permanent. */
export function assistantFailure(message?: string): SandboxExecutionFailure {
  const error = message ?? "Provider request failed";
  const permanent =
    /NON_RETRYABLE|usage limit|insufficient_quota|out of budget|billing|context.?length|context.?window|maximum context|too many tokens/i.test(
      error,
    );
  const transient =
    /RETRYABLE|overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|network.?error|connection.?error|fetch failed|socket hang up|timed? out|timeout/i.test(
      error,
    );
  return {
    code: "MODEL_REQUEST_FAILED",
    message: error.slice(0, RUN_FAILURE_MESSAGE_MAX_LENGTH),
    retryable: !permanent && transient,
  };
}

/** Normalizes an unexpected execution error into a bounded failure record. */
export function normalizeFailure(error: unknown): SandboxExecutionFailure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: message.startsWith("UNAVAILABLE") ? "UNAVAILABLE" : "PROVIDER_FAILED",
    message: message.slice(0, RUN_FAILURE_MESSAGE_MAX_LENGTH),
    retryable: true,
  };
}
