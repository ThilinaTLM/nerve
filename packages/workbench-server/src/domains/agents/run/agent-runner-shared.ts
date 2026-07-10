import type { AssistantMessage } from "@earendil-works/pi-ai";

export function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function errorTextFromToolResult(
  result: unknown,
  toolName: string,
): string {
  const record = recordFromUnknown(result);
  const content = Array.isArray(record.content) ? record.content : [];
  const text = content
    .map((part) => {
      const partRecord = recordFromUnknown(part);
      return partRecord.type === "text" && typeof partRecord.text === "string"
        ? partRecord.text
        : "";
    })
    .filter(Boolean)
    .join("\n");
  return text.trim() || `Tool ${toolName} failed before execution.`;
}

export function isRetryableAssistantError(message: AssistantMessage): boolean {
  if (message.stopReason !== "error" || !message.errorMessage) return false;
  const error = message.errorMessage;
  if (
    /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing|context.?length|context.?window|maximum context|too many tokens/i.test(
      error,
    )
  ) {
    return false;
  }
  return /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|stream ended before message_stop|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i.test(
    error,
  );
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sameStringList(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function assistantContentRedacted(
  message: AssistantMessage,
  contentIndex: number,
): boolean | undefined {
  const block = message.content[contentIndex];
  return block?.type === "thinking" ? block.redacted : undefined;
}

export function assistantToolCallDraft(
  message: AssistantMessage,
  contentIndex: number,
): { id?: string; name?: string } | undefined {
  const block = message.content[contentIndex];
  return block?.type === "toolCall"
    ? { id: block.id, name: block.name }
    : undefined;
}

export interface AssistantToolCallSnapshot {
  contentIndex: number;
  id?: string;
  name?: string;
  arguments: Record<string, unknown>;
}

export function assistantToolCallSnapshots(
  message: AssistantMessage,
): AssistantToolCallSnapshot[] {
  return message.content.flatMap((block, contentIndex) =>
    block.type === "toolCall"
      ? [
          {
            contentIndex,
            id: block.id,
            name: block.name,
            arguments: recordFromUnknown(block.arguments),
          },
        ]
      : [],
  );
}
