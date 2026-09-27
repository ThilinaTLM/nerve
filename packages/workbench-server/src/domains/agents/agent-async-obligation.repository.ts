import type {
  AgentAsyncObligation,
  AgentAsyncObligationState,
} from "@nervekit/contracts/agents";
import type {
  ConversationEntry,
  ConversationRecord,
} from "@nervekit/contracts/conversations";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/index.js";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { ConversationJournalRepository } from "../conversations/conversation-journal.repository.js";
import type {
  AgentAsyncObligationRepository,
  AsyncObligationNotice,
} from "./agent-async-obligation.service.js";

/** Journal-backed obligation writes with canonical indexed reads. */
export class JournalAgentAsyncObligationRepository implements AgentAsyncObligationRepository {
  constructor(
    private readonly journal: ConversationJournalRepository,
    private readonly canonical: CanonicalStore,
    private readonly events?: Pick<StreamLogRegistry, "publish">,
    private readonly modelOwnerAgentId?: (
      ownerAgentId: string,
    ) => string | undefined,
    private readonly projectCommittedConversation?: (
      entry: ConversationEntry,
      conversation: ConversationRecord | undefined,
    ) => void,
  ) {}

  async register(
    obligation: AgentAsyncObligation,
  ): Promise<AgentAsyncObligation> {
    const existing = await this.canonical.readAgentObligation(obligation.id);
    if (existing) return existing;
    await this.journal.commit(obligation.conversationId, {
      kind: "agent_obligation.registered",
      idempotencyKey: `agent-obligation:${obligation.id}:registered`,
      events: [this.upsertEvent(obligation)],
    });
    return (
      (await this.canonical.readAgentObligation(obligation.id)) ?? obligation
    );
  }

  get(id: string): Promise<AgentAsyncObligation | undefined> {
    return this.canonical.readAgentObligation(id);
  }

  async listByStates(
    states: readonly AgentAsyncObligationState[],
  ): Promise<readonly AgentAsyncObligation[]> {
    const selected = new Set(states);
    return (
      await this.canonical.scanObligationsForReconciliation(10_000)
    ).filter((obligation) => selected.has(obligation.state));
  }

  async transition(
    id: string,
    expected: readonly AgentAsyncObligationState[],
    patch: Partial<
      Pick<
        AgentAsyncObligation,
        | "state"
        | "outcome"
        | "updatedAt"
        | "deliveredAt"
        | "consumedAt"
        | "cancelledAt"
      >
    >,
  ): Promise<AgentAsyncObligation> {
    const current = await this.required(id);
    if (!expected.includes(current.state)) return current;
    const replacement = { ...current, ...patch };
    await this.journal.commit(current.conversationId, {
      kind: "agent_obligation.transitioned",
      idempotencyKey: `agent-obligation:${id}:${replacement.state}:${replacement.updatedAt}`,
      events: [this.upsertEvent(replacement)],
    });
    return (await this.canonical.readAgentObligation(id)) ?? replacement;
  }

  async deliverWithNotice(
    obligation: AgentAsyncObligation,
    notice: AsyncObligationNotice,
  ): Promise<AgentAsyncObligation> {
    const state = await this.journal.load(obligation.conversationId);
    const current = state.obligations.get(obligation.id) ?? obligation;
    if (current.state !== "ready") return current;
    const timestamp = notice.entry.createdAt;
    const delivered: AgentAsyncObligation = {
      ...current,
      state: "delivered",
      deliveredAt: timestamp,
      updatedAt: timestamp,
    };
    const parentEntryId = state.conversation?.activeEntryId;
    const entry: ConversationEntry = {
      ...notice.entry,
      parentEntryId,
    } as ConversationEntry;
    const conversation = state.conversation
      ? {
          ...state.conversation,
          activeEntryId: entry.id,
          updatedAt: timestamp,
        }
      : undefined;
    const modelOwnerAgentId = this.modelOwnerAgentId?.(obligation.ownerAgentId);
    const modelLeafId = modelOwnerAgentId
      ? state.agentModelLeafIds.get(modelOwnerAgentId)
      : state.modelLeafId;
    await this.journal.commit(
      obligation.conversationId,
      {
        kind: "agent_obligation.delivered",
        idempotencyKey: `agent-obligation:${obligation.id}:delivered`,
        events: [
          {
            kind: "conversation.entry_appended",
            conversationId: obligation.conversationId,
            entry,
          },
          ...(conversation
            ? [
                {
                  kind: "conversation.upserted" as const,
                  conversationId: obligation.conversationId,
                  conversation,
                },
              ]
            : []),
          {
            kind: "model_context.entry_appended",
            conversationId: obligation.conversationId,
            ownerAgentId: modelOwnerAgentId,
            entry: {
              type: "message",
              id: entry.id,
              parentId: modelLeafId ?? null,
              timestamp,
              message: notice.message,
            } as never,
          },
          {
            kind: "model_context.leaf_changed",
            conversationId: obligation.conversationId,
            ownerAgentId: modelOwnerAgentId,
            entryId: entry.id,
          },
          this.upsertEvent(delivered),
        ],
      },
      state.revision,
    );
    this.projectCommittedConversation?.(entry, conversation);
    await this.events?.publish("conversation.entry.appended", {
      conversationId: obligation.conversationId,
      agentId: obligation.ownerAgentId,
      runId: entry.runId,
      entry,
    });
    if (conversation) {
      await this.events?.publish("conversation.updated", { conversation });
    }
    return delivered;
  }

  private async required(id: string): Promise<AgentAsyncObligation> {
    const obligation = await this.canonical.readAgentObligation(id);
    if (!obligation) throw new Error(`Unknown agent async obligation '${id}'.`);
    return obligation;
  }

  private upsertEvent(obligation: AgentAsyncObligation) {
    return {
      kind: "agent_obligation.upserted" as const,
      conversationId: obligation.conversationId,
      obligation,
    };
  }
}
