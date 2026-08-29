import type { AssistantMessage } from "@earendil-works/pi-ai";
import { isRetryableProviderError } from "@nervekit/harness";

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
  return (
    message.stopReason === "error" &&
    isRetryableProviderError(message.errorMessage)
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
