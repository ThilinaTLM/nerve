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
        | "state"
        | "outcome"
        | "updatedAt"
        | "deliveredAt"
        | "consumedAt"
        | "cancelledAt"
      >
    >,
  ): Promise<AgentAsyncObligation>;
  /** Commits the notice/model-context append and ready -> delivered together. */
  deliverWithNotice(
    obligation: AgentAsyncObligation,
    notice: AsyncObligationNotice,
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
  activeRunId(
    conversationId: string,
    agentId: string,
  ): Promise<string | undefined>;
  enqueue(
    runId: string,
    obligation: AgentAsyncObligation,
    notice: AsyncObligationNotice,
  ): Promise<boolean>;
  wake(agentId: string): Promise<void>;
  now?(): string;
  warn?(error: unknown, obligation: AgentAsyncObligation): void;
  changed?(): void | Promise<void>;
}

/** Common idempotent delivery/recovery mechanics for awaited background work. */
export class AgentAsyncObligationService {
  private tail = Promise.resolve();
  private stopped = true;
  private readonly queued = new Map<string, string>();
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
    this.queued.clear();
  }

  async register(
    obligation: AgentAsyncObligation,
  ): Promise<AgentAsyncObligation> {
    const registered = await this.ports.repository.register(obligation);
    await this.ports.changed?.();
    return registered;
  }

  async markReady(id: string, outcome: string): Promise<AgentAsyncObligation> {
    const ready = await this.ports.repository.transition(id, ["pending"], {
      state: "ready",
      outcome,
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
      await this.ports.repository.transition(
        obligation.id,
        ["pending", "ready", "delivered"],
        { state: "suppressed", updatedAt: this.now() },
      );
      this.queued.delete(obligation.id);
      return;
    }

    const entries = await this.ports.entries(obligation.conversationId);
    const entry = entries.find(
      (candidate) => candidate.id === obligation.notificationEntryId,
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
      this.queued.delete(obligation.id);
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

    const activeRunId = await this.ports.activeRunId(
      obligation.conversationId,
      obligation.ownerAgentId,
    );
    if (!entry && current.state === "ready") {
      const notice = await adapter.buildNotice(current);
      if (activeRunId) {
        if (this.queued.get(current.id) === activeRunId) return;
        if (await this.ports.enqueue(activeRunId, current, notice)) {
          this.queued.set(current.id, activeRunId);
          return;
        }
      }
      current = await this.ports.repository.deliverWithNotice(current, notice);
    }

    if (current.state === "delivered" && !activeRunId && !this.stopped) {
      await this.ports.wake(current.ownerAgentId);
    }
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
