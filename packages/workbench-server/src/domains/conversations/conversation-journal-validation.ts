import { validateModelHistoryPath } from "./model-history-navigation.js";
import {
  assertAgentAsyncObligationReplacement,
  type AgentAsyncObligation,
} from "@nervekit/contracts/agents";
import type {
  ConversationInteractionRecord,
  ConversationJournalEvent,
} from "@nervekit/contracts/conversations";
import type { RunTransitionRecord } from "@nervekit/contracts/runs";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import type { ConversationTreeEntry } from "@nervekit/harness/conversation";
import type {
  ConversationJournalState,
  ConversationRunProjection,
} from "./conversation-journal.repository.js";

interface CommitPreview {
  runProjections: Map<string, ConversationRunProjection>;
}

export function validateCommitEvents(
  state: ConversationJournalState,
  events: ConversationJournalEvent[],
  conversationId: string,
): CommitPreview {
  const toolCalls = new Map<string, ToolCallRecord>();
  const interactions = new Map<string, ConversationInteractionRecord>();
  const runProjections = new Map<string, ConversationRunProjection>();
  const modelEntries = new Map<string, ConversationTreeEntry>();
  const prospectiveOwners = new Map<
    string,
    Map<string, ConversationTreeEntry>
  >();
  const ownerEntries = (ownerAgentId?: string) => {
    const key = ownerAgentId ?? "";
    let entries = prospectiveOwners.get(key);
    if (!entries) {
      entries = new Map(
        ownerAgentId
          ? state.agentModelEntryById.get(ownerAgentId)
          : state.modelEntryById,
      );
      prospectiveOwners.set(key, entries);
    }
    return entries;
  };
  const obligations = new Map<string, AgentAsyncObligation>();

  const toolCall = (id: string) => toolCalls.get(id) ?? state.toolCalls.get(id);
  const interaction = (id: string) =>
    interactions.get(id) ?? state.interactions.get(id);
  const runProjection = (id: string) =>
    runProjections.get(id) ?? state.runProjections.get(id);

  for (const event of events) {
    validateEventIdentity(event, conversationId);
    switch (event.kind) {
      case "model_context.entry_appended": {
        const incoming = event.entry as unknown as ConversationTreeEntry;
        const prospective = ownerEntries(event.ownerAgentId);
        const entry =
          event.ownerAgentId &&
          incoming.type === "compaction" &&
          incoming.parentId !== null &&
          !prospective.has(incoming.parentId)
            ? { ...incoming, parentId: null }
            : incoming;
        const current = event.ownerAgentId
          ? state.agentModelEntryById.get(event.ownerAgentId)?.get(entry.id)
          : state.modelEntryById.get(entry.id);
        const previous = modelEntries.get(
          `${event.ownerAgentId ?? ""}:${entry.id}`,
        );
        if (
          (current && JSON.stringify(current) !== JSON.stringify(entry)) ||
          (previous && JSON.stringify(previous) !== JSON.stringify(entry))
        ) {
          throw new Error(`Conflicting model-context entry '${entry.id}'.`);
        }
        if (!current && !previous && entry.parentId) {
          const parent = event.ownerAgentId
            ? state.agentModelEntryById
                .get(event.ownerAgentId)
                ?.get(entry.parentId)
            : state.modelEntryById.get(entry.parentId);
          const pendingParent = modelEntries.get(
            `${event.ownerAgentId ?? ""}:${entry.parentId}`,
          );
          if (
            !parent &&
            !pendingParent &&
            !(event.ownerAgentId && entry.type === "compaction")
          ) {
            throw new Error(
              `Unknown model-context parent '${entry.parentId}'.`,
            );
          }
        }
        modelEntries.set(`${event.ownerAgentId ?? ""}:${entry.id}`, entry);
        prospective.set(entry.id, entry);
        validateModelHistoryPath(
          prospective,
          entry.type === "leaf" ? entry.targetId : entry.id,
        );
        break;
      }
      case "model_context.leaf_changed":
        validateModelHistoryPath(
          ownerEntries(event.ownerAgentId),
          event.entryId,
        );
        break;
      case "tool_call.upserted": {
        const previous = toolCall(event.toolCall.id);
        if (previous && event.toolCall.revision < previous.revision) {
          throw new Error(
            `Tool-call revision moved backwards for '${event.toolCall.id}'.`,
          );
        }
        toolCalls.set(event.toolCall.id, event.toolCall);
        break;
      }
      case "interaction.upserted": {
        const currentToolCall = toolCall(event.interaction.toolCallId);
        if (
          !currentToolCall ||
          currentToolCall.revision !== event.interaction.toolCallRevision
        ) {
          throw new Error("Conversation interaction tool revision is stale.");
        }
        interactions.set(event.interaction.id, event.interaction);
        break;
      }
      case "suspension.upserted":
        for (const member of event.suspension.members) {
          const currentInteraction = interaction(member.interactionId);
          if (
            !currentInteraction ||
            currentInteraction.suspensionId !== event.suspension.id ||
            currentInteraction.checkpointId !== event.suspension.checkpointId ||
            currentInteraction.toolCallId !== member.toolCallId ||
            currentInteraction.toolCallRevision !== member.toolCallRevision
          ) {
            throw new Error("Conversation suspension member is inconsistent.");
          }
        }
        break;
      case "agent_obligation.upserted": {
        const previous =
          obligations.get(event.obligation.id) ??
          state.obligations.get(event.obligation.id);
        if (previous) {
          assertAgentAsyncObligationReplacement(previous, event.obligation);
        }
        obligations.set(event.obligation.id, event.obligation);
        break;
      }
      case "run.transition_committed": {
        const previous = runProjection(event.transition.runId);
        if (
          event.transition.previousRevision !== (previous?.run.revision ?? 0)
        ) {
          throw new Error(
            `Run transition chain is invalid for '${event.transition.runId}'.`,
          );
        }
        runProjections.set(
          event.transition.runId,
          applyRunProjectionTransition(previous, event.transition),
        );
        break;
      }
      case "run.event_delivered": {
        const previous = runProjection(event.delivery.runId);
        if (!previous) {
          throw new Error(
            `Run delivery '${event.delivery.intentId}' has no run projection.`,
          );
        }
        const deliveries = previous.deliveries.some(
          (delivery) => delivery.intentId === event.delivery.intentId,
        )
          ? previous.deliveries
          : [...previous.deliveries, event.delivery];
        runProjections.set(event.delivery.runId, {
          ...previous,
          deliveries,
        });
        break;
      }
    }
  }
  return { runProjections };
}

function validateEventIdentity(
  event: ConversationJournalEvent,
  conversationId: string,
): void {
  if (event.conversationId !== conversationId) {
    throw new Error("Conversation journal event identity mismatch.");
  }
  if (
    (event.kind === "conversation.upserted" &&
      event.conversation.id !== conversationId) ||
    (event.kind === "conversation.entry_appended" &&
      event.entry.conversationId !== conversationId) ||
    (event.kind === "tool_call.upserted" &&
      event.toolCall.conversationId !== conversationId) ||
    (event.kind === "interaction.upserted" &&
      event.interaction.conversationId !== conversationId) ||
    (event.kind === "suspension.upserted" &&
      event.suspension.conversationId !== conversationId) ||
    (event.kind === "run.transition_committed" &&
      event.transition.run.conversationId !== conversationId) ||
    (event.kind === "agent_obligation.upserted" &&
      event.obligation.conversationId !== conversationId)
  ) {
    throw new Error("Conversation journal record identity mismatch.");
  }
}

export function applyRunProjectionTransition(
  previous: ConversationRunProjection | undefined,
  transition: RunTransitionRecord,
): ConversationRunProjection {
  const prompts = new Map(
    previous?.prompts.map((record) => [record.id, record] as const),
  );
  const interactions = new Map(
    previous?.interactions.map((record) => [record.id, record] as const),
  );
  const checkpoints = new Map(
    previous?.checkpoints.map(
      (record) => [record.checkpointId, record] as const,
    ),
  );
  for (const record of transition.prompts) prompts.set(record.id, record);
  for (const record of transition.interactions)
    interactions.set(record.id, record);
  for (const record of transition.checkpoints)
    checkpoints.set(record.checkpointId, record);
  return {
    run: transition.run,
    prompts: [...prompts.values()].sort(
      (left, right) => left.ordinal - right.ordinal,
    ),
    interactions: [...interactions.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    ),
    checkpoints: [...checkpoints.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    ),
    transitions: [...(previous?.transitions ?? []), transition],
    deliveries: [...(previous?.deliveries ?? [])],
  };
}
