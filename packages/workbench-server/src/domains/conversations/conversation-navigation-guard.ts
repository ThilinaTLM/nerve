import {
  agentContextBindingSchema,
  agentRecordSchema,
} from "@nervekit/contracts/agents";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/index.js";
import { ApplicationError } from "../../core/application-error.js";
import { resolveCompactionOwner } from "./compaction-owner.js";
import type { ConversationJournalState } from "./conversation-journal.repository.js";
import {
  StaleNavigationError,
  validateModelHistoryPath,
  validateNavigationTarget,
  type NavigationCommitGuard,
} from "./model-history-navigation.js";

/** Admission is acquired by the caller before the journal lock, never here. */
export async function validateNavigationCommitGuard(
  canonical: CanonicalStore,
  state: ConversationJournalState,
  guard: NavigationCommitGuard,
): Promise<void> {
  const document = await canonical.readDocument<unknown>(
    "agent",
    "global",
    guard.agentId,
  );
  const parsed = agentRecordSchema.safeParse(document?.data);
  if (
    !parsed.success ||
    parsed.data.id !== guard.agentId ||
    parsed.data.conversationId !== state.conversationId ||
    parsed.data.projectId !== state.conversation?.projectId ||
    parsed.data.contextOwnerAgentId === undefined ||
    resolveCompactionOwner(state.conversationId, parsed.data).ownerAgentId !==
      guard.ownerAgentId
  )
    throw new ApplicationError(
      409,
      "INVALID_NAVIGATION_OWNER",
      "Navigation owner is missing or changed.",
    );
  if (guard.ownerAgentId !== undefined && guard.ownerAgentId !== guard.agentId)
    throw new ApplicationError(
      409,
      "INVALID_NAVIGATION_OWNER",
      "Navigation model owner is not the persisted agent context.",
    );
  if (guard.ownerAgentId === undefined) {
    if (parsed.data.parentAgentId)
      throw new ApplicationError(
        409,
        "INVALID_NAVIGATION_OWNER",
        "Shared child views cannot control conversation navigation.",
      );
    const bindingDocument = await canonical.readDocument<unknown>(
      "agent-context-binding",
      "global",
      state.conversationId,
    );
    const binding = agentContextBindingSchema.safeParse(bindingDocument?.data);
    if (!binding.success || binding.data.legacyRootAgentId !== guard.agentId)
      throw new ApplicationError(
        409,
        "INVALID_NAVIGATION_OWNER",
        "Conversation control owner is not its persisted legacy binding.",
      );
  }
  const leaf = guard.ownerAgentId
    ? (state.agentModelLeafIds.get(guard.ownerAgentId) ?? null)
    : state.modelLeafId;
  if (
    (state.conversation?.activeEntryId ?? null) !==
      guard.expectedActiveEntryId ||
    leaf !== guard.expectedModelLeafId
  )
    throw new StaleNavigationError();
  const entries = guard.ownerAgentId
    ? (state.agentModelEntryById.get(guard.ownerAgentId) ?? new Map())
    : state.modelEntryById;
  validateNavigationTarget(entries, guard.targetEntryId);
  if (guard.requireValidSource) validateModelHistoryPath(entries, leaf);
}
