import type {
  AgentAsyncObligation,
  AgentAsyncObligationState,
  AgentRecord,
} from "@nervekit/contracts/agents";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import type { HarnessMessage } from "@nervekit/harness/messages";
import type { AppendEntryInput } from "../conversations/append-entry-contracts.js";

const RECOVERABLE_STATES: readonly AgentAsyncObligationState[] = [
  "ready",
  "delivered",
];

export interface AsyncObligationNotice {
  entry: AppendEntryInput & { id: string; createdAt: string };
  message: HarnessMessage;
  activation?: "wake_if_idle" | "queue_only";
}

export interface AgentAsyncObligationRepository {
  register(obligation: AgentAsyncObligation): Promise<AgentAsyncObligation>;
  get(id: string): Promise<AgentAsyncObligation | undefined>;
  listByStates(
    states: readonly AgentAsyncObligationState[],
  ): Promise<readonly AgentAsyncObligation[]>;
  transition(
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
  ): Promise<AgentAsyncObligation>;
}

export interface AsyncObligationSourceAdapter {
  readonly kind: AgentAsyncObligation["sourceKind"];
  allow(obligation: AgentAsyncObligation): Promise<boolean>;
  buildNotice(obligation: AgentAsyncObligation): Promise<AsyncObligationNotice>;
}

export interface AgentAsyncObligationServicePorts {
  repository: AgentAsyncObligationRepository;
  adapters: readonly AsyncObligationSourceAdapter[];
  getAgent(id: string): AgentRecord;
  entries(conversationId: string): Promise<readonly ConversationEntry[]>;
  /** Persist through the sole shared agent-input queue; safe on replay. */
  acceptNotice(
    obligation: AgentAsyncObligation,
    notice: AsyncObligationNotice,
  ): Promise<string>;
  cancelNotice(agentId: string, inputId: string): Promise<void>;
  now?(): string;
  warn?(error: unknown, obligation: AgentAsyncObligation): void;
  changed?(): void | Promise<void>;
}

/** Common idempotent delivery/recovery mechanics for awaited background work. */
export class AgentAsyncObligationService {
  private tail = Promise.resolve();
  private stopped = true;
  private readonly adapters: Map<
    AgentAsyncObligation["sourceKind"],
    AsyncObligationSourceAdapter
  >;

  constructor(private readonly ports: AgentAsyncObligationServicePorts) {
    this.adapters = new Map(
      ports.adapters.map((adapter) => [adapter.kind, adapter] as const),
    );
  }

  start(): void {
    this.stopped = false;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.tail;
  }

  async register(
    obligation: AgentAsyncObligation,
  ): Promise<AgentAsyncObligation> {
    const registered = await this.ports.repository.register(obligation);
    await this.ports.changed?.();
    return registered;
  }

  async markReady(
    id: string,
    outcome: string,
    completion?: AgentAsyncObligation["completion"],
  ): Promise<AgentAsyncObligation> {
    const ready = await this.ports.repository.transition(id, ["pending"], {
      state: "ready",
      outcome,
      completion,
      updatedAt: this.now(),
    });
    await this.ports.changed?.();
    return ready;
  }

  recover(): Promise<void> {
    const next = this.tail.then(async () => {
      await this.sweep();
      await this.ports.changed?.();
    });
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async sweep(): Promise<void> {
    if (this.stopped) return;
    const obligations =
      await this.ports.repository.listByStates(RECOVERABLE_STATES);
    for (const obligation of obligations) {
      if (this.stopped) return;
      try {
        await this.deliverOrConsume(obligation);
      } catch (error) {
        this.ports.warn?.(error, obligation);
      }
    }
  }

  private async deliverOrConsume(
    obligation: AgentAsyncObligation,
  ): Promise<void> {
    const adapter = this.adapters.get(obligation.sourceKind);
    if (!adapter) throw new Error(`No adapter for '${obligation.sourceKind}'.`);
    if (!(await adapter.allow(obligation))) {
      if (obligation.queueInputId)
        await this.ports.cancelNotice(
          obligation.ownerAgentId,
          obligation.queueInputId,
        );
      await this.ports.repository.transition(
        obligation.id,
        ["pending", "ready", "delivered"],
        { state: "suppressed", updatedAt: this.now() },
      );
      return;
    }

    const entries = await this.ports.entries(obligation.conversationId);
    const entry = entries.find(
      (candidate) =>
        candidate.id ===
        (obligation.queueInputId
          ? `entry_${obligation.queueInputId}`
          : obligation.notificationEntryId),
    );
    if (
      entry &&
      hasAssistantDescendant(entries, entry.id, obligation.ownerAgentId)
    ) {
      await this.ports.repository.transition(
        obligation.id,
        ["ready", "delivered"],
        {
          state: "consumed",
          deliveredAt: obligation.deliveredAt ?? entry.createdAt,
          consumedAt: this.now(),
          updatedAt: this.now(),
        },
      );
      return;
    }

    let current = obligation;
    if (entry && obligation.state === "ready") {
      current = await this.ports.repository.transition(
        obligation.id,
        ["ready"],
        {
          state: "delivered",
          deliveredAt: entry.createdAt,
          updatedAt: this.now(),
        },
      );
    }

    if (!entry && current.state === "ready" && !current.queueInputId) {
      const notice = await adapter.buildNotice(current);
      const queueInputId = await this.ports.acceptNotice(current, notice);
      await this.ports.repository.transition(current.id, ["ready"], {
        queueInputId,
        updatedAt: this.now(),
      });
    }
    // Activation is owned by common input acceptance. Never separately wake a
    // delivered obligation: a stale completion must not bypass a stop fence.
  }

  private now(): string {
    return this.ports.now?.() ?? new Date().toISOString();
  }
}

export function hasAssistantDescendant(
  entries: readonly ConversationEntry[],
  entryId: string,
  ownerAgentId: string,
): boolean {
  const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
  return entries.some((entry) => {
    if (entry.role !== "assistant" || entry.agentId !== ownerAgentId)
      return false;
    const visited = new Set<string>();
    let parentId = entry.parentEntryId;
    while (parentId && !visited.has(parentId)) {
      if (parentId === entryId) return true;
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentEntryId;
    }
    return false;
  });
}
