import { createHash } from "node:crypto";
import {
  CONVERSATION_JOURNAL_EPOCH,
  type ConversationJournalCommit,
} from "@nervekit/contracts/conversations";
import {
  normalizeLegacyToolCallRecord,
  type ToolCallRecord,
} from "@nervekit/contracts/tools";
import type { ConversationJournalState } from "./conversation-journal.repository.js";
import { validateCommitEvents } from "./conversation-journal-validation.js";

export function journalChecksum(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function normalizeLegacyToolCalls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeLegacyToolCalls);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const normalized = Object.hasOwn(record, "permissionEvaluation")
    ? (normalizeLegacyToolCallRecord(record as ToolCallRecord) as Record<
        string,
        unknown
      >)
    : record;
  return Object.fromEntries(
    Object.entries(normalized).map(([key, child]) => [
      key,
      normalizeLegacyToolCalls(child),
    ]),
  );
}

export function verifyConversationJournalCommit(
  state: ConversationJournalState,
  commit: ConversationJournalCommit,
  checksumSource: Record<string, unknown> = commit,
): void {
  if (
    commit.epoch !== CONVERSATION_JOURNAL_EPOCH ||
    commit.conversationId !== state.conversationId ||
    commit.previousRevision !== state.revision ||
    commit.revision !== state.revision + 1 ||
    commit.previousChecksum !== state.checksum
  ) {
    throw new Error(
      `Conversation journal '${state.conversationId}' has an invalid commit chain.`,
    );
  }
  const base = Object.fromEntries(
    Object.entries(checksumSource).filter(([key]) => key !== "checksum"),
  );
  if (journalChecksum(base) !== commit.checksum) {
    throw new Error(
      `Conversation journal '${state.conversationId}' has a checksum mismatch.`,
    );
  }
  validateCommitEvents(state, commit.events, state.conversationId);
}
