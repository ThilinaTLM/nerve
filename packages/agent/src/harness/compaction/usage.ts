import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { ContextUsage } from "@nerve/shared";
import type { AgentMessage } from "../../types.js";
import type {
  CompactionEntry,
  ConversationTreeEntry,
} from "../conversation/entries.js";
import type { ContextUsageEstimate } from "./types.js";

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

/** Calculate total context tokens from provider usage. */
export function calculateContextTokens(usage: Usage): number {
  return (
    usage.totalTokens ||
    usage.input + usage.output + usage.cacheRead + usage.cacheWrite
  );
}

function getAssistantUsage(msg: AgentMessage): Usage | undefined {
  if (msg.role === "assistant" && "usage" in msg) {
    const assistantMsg = msg as AssistantMessage;
    if (
      assistantMsg.stopReason !== "aborted" &&
      assistantMsg.stopReason !== "error" &&
      assistantMsg.usage
    ) {
      return assistantMsg.usage;
    }
  }
  return undefined;
}

/** Return usage from the last successful assistant message in conversation entries. */
export function getLastAssistantUsage(
  entries: ConversationTreeEntry[],
): Usage | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "message") {
      const usage = getAssistantUsage(entry.message as AgentMessage);
      if (usage) return usage;
    }
  }
  return undefined;
}

function getLastAssistantUsageInfo(
  messages: AgentMessage[],
): { usage: Usage; index: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = getAssistantUsage(messages[i]);
    if (usage) return { usage, index: i };
  }
  return undefined;
}

/** Estimate context tokens for messages using provider usage when available. */
export function estimateContextTokens(
  messages: AgentMessage[],
): ContextUsageEstimate {
  const usageInfo = getLastAssistantUsageInfo(messages);

  if (!usageInfo) {
    let estimated = 0;
    for (const message of messages) {
      estimated += estimateTokens(message);
    }
    return {
      tokens: estimated,
      usageTokens: 0,
      trailingTokens: estimated,
      lastUsageIndex: null,
    };
  }

  const usageTokens = calculateContextTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (let i = usageInfo.index + 1; i < messages.length; i++) {
    trailingTokens += estimateTokens(messages[i]);
  }

  return {
    tokens: usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex: usageInfo.index,
  };
}

/** Return the most recent compaction entry in a branch, if any. */
export function getLatestCompactionEntry(
  entries: ConversationTreeEntry[],
): CompactionEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "compaction") return entry;
  }
  return undefined;
}

/**
 * Compute compaction-aware context-window usage.
 *
 * Mirrors pi's `AgentConversation.getContextUsage()`:
 * - `contextWindow <= 0` -> usage unknown (`tokens`/`percent` null).
 * - After the latest compaction, usage is unknown until a fresh, non-aborted
 *   assistant response provides usage again.
 * - Otherwise estimate from messages and report a percentage of the window.
 *
 * @param messages Reconstructed branch messages (e.g. from `buildConversationContext`).
 * @param branchEntries Raw branch entries used to detect the compaction boundary.
 * @param contextWindow The selected model's context window (0 when unknown).
 */
export function computeContextUsage(
  messages: AgentMessage[],
  branchEntries: ConversationTreeEntry[],
  contextWindow: number,
): ContextUsage {
  if (contextWindow <= 0) {
    return { tokens: null, contextWindow: 0, percent: null };
  }

  const latestCompaction = getLatestCompactionEntry(branchEntries);
  if (latestCompaction) {
    const compactionIndex = branchEntries.lastIndexOf(latestCompaction);
    let hasPostCompactionUsage = false;
    for (let i = branchEntries.length - 1; i > compactionIndex; i--) {
      const entry = branchEntries[i];
      if (entry.type === "message") {
        const usage = getAssistantUsage(entry.message as AgentMessage);
        if (usage) {
          hasPostCompactionUsage = calculateContextTokens(usage) > 0;
          break;
        }
      }
    }
    if (!hasPostCompactionUsage) {
      return { tokens: null, contextWindow, percent: null };
    }
  }

  const estimate = estimateContextTokens(messages);
  const percent = (estimate.tokens / contextWindow) * 100;
  return { tokens: estimate.tokens, contextWindow, percent };
}

const ESTIMATED_IMAGE_CHARS = 4800;

function estimateTextAndImageContentChars(
  content: string | Array<{ type: string; text?: string }>,
): number {
  if (typeof content === "string") {
    return content.length;
  }

  let chars = 0;
  for (const block of content) {
    if (block.type === "text" && block.text) {
      chars += block.text.length;
    } else if (block.type === "image") {
      chars += ESTIMATED_IMAGE_CHARS;
    }
  }
  return chars;
}

/** Estimate token count for one message using a conservative character heuristic. */
export function estimateTokens(message: AgentMessage): number {
  let chars = 0;

  switch (message.role) {
    case "user": {
      chars = estimateTextAndImageContentChars(
        (
          message as {
            content: string | Array<{ type: string; text?: string }>;
          }
        ).content,
      );
      return Math.ceil(chars / 4);
    }
    case "assistant": {
      const assistant = message as AssistantMessage;
      for (const block of assistant.content) {
        if (block.type === "text") {
          chars += block.text.length;
        } else if (block.type === "thinking") {
          chars += block.thinking.length;
        } else if (block.type === "toolCall") {
          chars +=
            block.name.length + safeJsonStringify(block.arguments).length;
        }
      }
      return Math.ceil(chars / 4);
    }
    case "custom":
    case "toolResult": {
      chars = estimateTextAndImageContentChars(message.content);
      return Math.ceil(chars / 4);
    }
    case "bashExecution": {
      chars = message.command.length + message.output.length;
      return Math.ceil(chars / 4);
    }
    case "branchSummary":
    case "compactionSummary": {
      chars = message.summary.length;
      return Math.ceil(chars / 4);
    }
  }

  return 0;
}
