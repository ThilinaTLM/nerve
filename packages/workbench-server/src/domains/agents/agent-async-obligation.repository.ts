import type {
  AgentAsyncObligation,
  AgentAsyncObligationState,
} from "@nervekit/contracts/agents";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/index.js";
import type { ConversationJournalRepository } from "../conversations/conversation-journal.repository.js";
import type { AgentAsyncObligationRepository } from "./agent-async-obligation.service.js";

/** Journal-backed obligation writes with canonical indexed reads. */
export class JournalAgentAsyncObligationRepository implements AgentAsyncObligationRepository {
  constructor(
    private readonly journal: ConversationJournalRepository,
    private readonly canonical: CanonicalStore,
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
        | "completion"
        | "queueInputId"
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
