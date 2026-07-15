import type { ConversationEntry } from "@nervekit/contracts";
import type { TranscriptItem } from "@nervekit/workbench-ui/state";

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function inlineCommandPromptTexts(entry: ConversationEntry): Set<string> {
  const details = recordValue(entry.details);
  if (details?.type !== "inline_command_result") return new Set();
  const command =
    typeof details.command === "string" ? details.command.trim() : "";
  if (!command) return new Set();
  return new Set([`!${command}`, `! ${command}`]);
}

/** Build the locally echoed user row for a just-sent prompt. */
export function optimisticUserMessage(text: string): TranscriptItem {
  return { role: "user", text, optimistic: true };
}

/**
 * Drop optimistic user rows superseded by a durable entry: any user entry
 * replaces the locally echoed prompt, and inline command results suppress the
 * echoed `!command` prompt they answered. Returns the same array when nothing
 * changes so downstream memoization keeps its identity.
 */
export function reconcileOptimisticMessages(
  optimisticMessages: TranscriptItem[],
  entry: ConversationEntry,
): TranscriptItem[] {
  if (optimisticMessages.length === 0) return optimisticMessages;
  const inlineCommandPrompts = inlineCommandPromptTexts(entry);
  const next = optimisticMessages.filter((item) => {
    if (item.role !== "user") return true;
    if (entry.role === "user") return false;
    return !inlineCommandPrompts.has(item.text.trim());
  });
  return next.length === optimisticMessages.length ? optimisticMessages : next;
}
