import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@nervekit/harness/agent";
import {
  InMemoryConversationStorage,
  type ConversationMetadata,
  type ConversationStorage,
  type ConversationTreeEntry,
} from "@nervekit/harness/conversation";
import type { CanonicalConversationEntry } from "@nervekit/contracts/conversations";
import type { CanonicalContextSnapshot } from "../../conversations/timeline/canonical-conversation-context.service.js";

/**
 * Materializes disposable harness state from one fenced canonical ancestry.
 * The returned storage is deliberately memory-only and must never be treated as
 * durable authority. New entries are committed through canonical transitions.
 */
export function createCanonicalHarnessContext(input: {
  snapshot: CanonicalContextSnapshot;
  createdAt: string;
}): ConversationStorage<ConversationMetadata> {
  return new InMemoryConversationStorage({
    metadata: {
      id: input.snapshot.conversationId,
      createdAt: input.createdAt,
    },
    entries: input.snapshot.entries.map(toHarnessEntry),
    entryIdFactory: () => `entry_${randomUUID()}`,
  });
}

function toHarnessEntry(
  entry: CanonicalConversationEntry,
): ConversationTreeEntry {
  const inline = inlineRecord(entry.inlineContent);
  const timestamp =
    stringValue(entry.provenance.legacyCreatedAt) ??
    stringValue(entry.provenance.createdAt) ??
    new Date(0).toISOString();
  if (entry.kind === "summary") {
    const fromId = stringValue(inline.fromEntryId) ?? entry.parentEntryId;
    if (!fromId) {
      throw new Error(`Canonical summary '${entry.entryId}' has no source.`);
    }
    return {
      type: "branch_summary",
      id: entry.entryId,
      parentId: entry.parentEntryId,
      timestamp,
      fromId,
      summary:
        stringValue(inline.summary) ?? stringValue(inline.text) ?? "Summary",
      details: inline.details,
      fromHook: true,
    };
  }
  const exact = inline.exactHarnessMessage;
  if (isAgentMessage(exact)) {
    return {
      type: "message",
      id: entry.entryId,
      parentId: entry.parentEntryId,
      timestamp,
      message: exact,
    };
  }
  if (entry.kind === "user_message" || entry.kind === "assistant_message") {
    return {
      type: "message",
      id: entry.entryId,
      parentId: entry.parentEntryId,
      timestamp,
      message: {
        role: entry.kind === "user_message" ? "user" : "assistant",
        content: stringValue(inline.text) ?? "",
        timestamp: Date.parse(timestamp),
      } as AgentMessage,
    };
  }
  throw new Error(
    `Canonical '${entry.kind}' entry '${entry.entryId}' lacks an exact harness message.`,
  );
}

function inlineRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isAgentMessage(value: unknown): value is AgentMessage {
  return Boolean(
    value !== null &&
    typeof value === "object" &&
    "role" in value &&
    typeof (value as { role?: unknown }).role === "string",
  );
}
