import type {
  ConversationJournalEvent,
  RunEventDeliveryRecord,
  RunRecord,
  RunTransitionRecord,
} from "@nervekit/contracts";
import {
  runEventDeliveryRecordSchema,
  runTransitionRecordSchema,
} from "@nervekit/contracts";
import { ConversationJournalRepository } from "../conversations/conversation-journal.repository.js";
import {
  ACTIVE_STATUSES,
  ActiveRunLookup,
  applyRunEventDelivery,
  applyRunTransition,
  BoundedRunStateCache,
  RunRevisionConflictError,
  type RunHydratedState,
  type RunUnitOfWorkPort,
} from "./runtime/index.js";

export const DELIVERY_SETTLED_PREFIX = "__nerve_settled__";

export function deliverySettledIntentId(
  runId: string,
  revision: number,
): string {
  return `${DELIVERY_SETTLED_PREFIX}:${runId}:${revision}`;
}

export function isDeliverySettledRecord(
  delivery: RunEventDeliveryRecord | undefined,
): delivery is RunEventDeliveryRecord {
  return delivery?.intentId.startsWith(DELIVERY_SETTLED_PREFIX) === true;
}

/** Run projection/unit of work backed by conversation aggregate journals. */
export class WorkbenchRunUnitOfWork implements RunUnitOfWorkPort {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly cache: BoundedRunStateCache;
  private metadata: RunRecord[] | undefined;
  private readonly lookup = new ActiveRunLookup({
    load: (runId) => this.load(runId),
    hydrateActive: () => this.hydrateAllActive(),
  });

  private readonly journal: ConversationJournalRepository;

  constructor(
    journalOrHome: ConversationJournalRepository | string,
    cacheMaximum = 32,
  ) {
    this.journal =
      typeof journalOrHome === "string"
        ? new ConversationJournalRepository({ paths: { home: journalOrHome } })
        : journalOrHome;
    this.cache = new BoundedRunStateCache(cacheMaximum);
  }

  async load(runId: string): Promise<RunHydratedState | undefined> {
    const cached = this.cache.get(runId);
    if (cached) return cached;
    const state = await this.hydrate(runId);
    if (state) {
      this.cache.set(state);
      this.lookup.observe(state);
    }
    return state;
  }

  async loadFresh(runId: string): Promise<RunHydratedState | undefined> {
    return this.exclusive(runId, async () => {
      const state = await this.hydrate(runId);
      if (state) {
        this.cache.set(state);
        this.lookup.observe(state);
      }
      return state;
    });
  }

  async findActive(scopeId: string): Promise<RunHydratedState | undefined> {
    return this.lookup.findActive(scopeId);
  }

  async listActive(): Promise<readonly RunHydratedState[]> {
    return this.lookup.listActive();
  }

  async findByInteractionId(
    interactionId: string,
  ): Promise<RunHydratedState | undefined> {
    return this.lookup.findByInteractionId(interactionId);
  }

  async findByInteractionToolCallId(
    toolCallId: string,
  ): Promise<RunHydratedState | undefined> {
    return this.lookup.findByInteractionToolCallId(toolCallId);
  }

  async findByPromptId(
    promptId: string,
  ): Promise<RunHydratedState | undefined> {
    return this.lookup.findByPromptId(promptId);
  }

  async list(): Promise<readonly RunHydratedState[]> {
    const states: RunHydratedState[] = [];
    for (const journalState of await this.journal.hydrateAll()) {
      for (const runId of journalState.runProjections.keys()) {
        const cached = this.cache.get(runId);
        const state = cached ?? this.reduceFromJournal(journalState, runId);
        if (!state) continue;
        if (!cached && ACTIVE_STATUSES.has(state.run.status))
          this.cache.set(state);
        this.lookup.observe(state);
        states.push(state);
      }
    }
    this.lookup.markInitialized();
    return states.sort((left, right) =>
      left.run.updatedAt.localeCompare(right.run.updatedAt),
    );
  }

  async hasActionableInteraction(
    runId: string,
    toolCallId: string,
  ): Promise<boolean> {
    const runState = await this.loadFresh(runId);
    if (!runState || runState.run.status !== "waiting") return false;
    const journalState = await this.journal.load(runState.run.conversationId);
    const interaction = [...journalState.interactions.values()].find(
      (candidate) =>
        candidate.runId === runId &&
        candidate.executionId === runState.run.executionId &&
        candidate.toolCallId === toolCallId &&
        candidate.interaction.status !== "cancelled",
    );
    if (!interaction) return false;
    const suspension = journalState.suspensions.get(interaction.suspensionId);
    const toolCall = journalState.toolCalls.get(toolCallId);
    const member = suspension?.members.find(
      (candidate) => candidate.interactionId === interaction.id,
    );
    return Boolean(
      suspension?.status === "open" &&
      member &&
      toolCall &&
      member.toolCallRevision === interaction.toolCallRevision &&
      toolCall.revision === interaction.toolCallRevision,
    );
  }

  async listMetadata(): Promise<readonly RunRecord[]> {
    return (this.metadata ??= await this.scanMetadata());
  }

  async hydrateAllActive(): Promise<void> {
    const records = await this.scanMetadata();
    this.metadata = records;
    for (const record of records) {
      if (!ACTIVE_STATUSES.has(record.status)) continue;
      const state = await this.hydrate(record.runId);
      if (state) {
        this.cache.set(state);
        this.lookup.observe(state);
      }
    }
    this.lookup.markInitialized();
  }

  async commit(
    expectedRevision: number,
    transition: RunTransitionRecord,
  ): Promise<RunHydratedState> {
    const parsed = runTransitionRecordSchema.parse(
      JSON.parse(JSON.stringify(transition)) as unknown,
    );
    return this.exclusive(parsed.runId, async () => {
      const current = await this.load(parsed.runId);
      const actualRevision = current?.run.revision ?? 0;
      if (actualRevision !== expectedRevision) {
        throw new RunRevisionConflictError(
          `Run ${parsed.runId} expected revision ${expectedRevision}, found ${actualRevision}`,
        );
      }
      const next = applyRunTransition(current, parsed);
      const events: ConversationJournalEvent[] = [
        {
          kind: "run.transition_committed",
          conversationId: parsed.run.conversationId,
          transition: parsed,
        },
        ...(await this.normalizedInteractionEvents(next, parsed)),
      ];
      await this.journal.commit(parsed.run.conversationId, {
        kind: `run.${parsed.kind}`,
        committedAt: parsed.committedAt,
        events,
      });
      this.cache.set(next);
      this.lookup.observe(next);
      this.metadata = undefined;
      return next;
    });
  }

  async pendingEventIntents() {
    const pending: Array<{
      runId: string;
      revision: number;
      intent: RunTransitionRecord["events"][number];
    }> = [];
    for (const state of await this.list()) {
      const journalState = await this.journal.load(state.run.conversationId);
      const delivered = new Set(state.deliveries.map((item) => item.intentId));
      for (const transition of state.transitions) {
        for (const intent of transition.events) {
          if (!delivered.has(intent.id)) {
            const conversationRevision =
              journalState.intentConversationRevisions.get(intent.id);
            pending.push({
              runId: transition.runId,
              revision: transition.revision,
              intent:
                conversationRevision === undefined || !isRecord(intent.data)
                  ? intent
                  : {
                      ...intent,
                      data: { ...intent.data, conversationRevision },
                    },
            });
          }
        }
      }
    }
    return pending.sort(
      (left, right) =>
        left.intent.occurredAt.localeCompare(right.intent.occurredAt) ||
        left.intent.id.localeCompare(right.intent.id),
    );
  }

  async markDeliverySettled(runId: string, revision: number): Promise<void> {
    const intentId = deliverySettledIntentId(runId, revision);
    await this.markEventDelivered({
      intentId,
      runId,
      revision,
      eventId: intentId.slice(0, 256),
      sequence: revision,
      deliveredAt: new Date().toISOString(),
    });
  }

  async markEventDelivered(delivery: RunEventDeliveryRecord): Promise<void> {
    const parsed = runEventDeliveryRecordSchema.parse(delivery);
    await this.exclusive(parsed.runId, async () => {
      const state = await this.load(parsed.runId);
      if (!state) throw new Error(`Unknown run: ${parsed.runId}`);
      const next = applyRunEventDelivery(state, parsed);
      if (next === state) return;
      await this.journal.commit(state.run.conversationId, {
        kind: "run.event_delivered",
        committedAt: parsed.deliveredAt,
        events: [
          {
            kind: "run.event_delivered",
            conversationId: state.run.conversationId,
            delivery: parsed,
          },
        ],
      });
      this.cache.set(next);
    });
  }

  async materialize(): Promise<void> {
    // Journal projections are materialized in memory; files are not authoritative.
  }

  private async normalizedInteractionEvents(
    state: RunHydratedState,
    transition: RunTransitionRecord,
  ): Promise<ConversationJournalEvent[]> {
    if (transition.interactions.length === 0) return [];
    const journalState = await this.journal.load(state.run.conversationId);
    const events: ConversationJournalEvent[] = [];
    const checkpointIds = new Set(
      transition.interactions.map((interaction) => interaction.checkpointId),
    );
    for (const runInteraction of transition.interactions) {
      const toolCall = journalState.toolCalls.get(runInteraction.toolCallId);
      const toolInteraction =
        toolCall?.interactions[runInteraction.interactionOrdinal];
      if (!toolCall || !toolInteraction) {
        throw new Error(
          `Run interaction '${runInteraction.id}' has no canonical tool interaction.`,
        );
      }
      events.push({
        kind: "interaction.upserted",
        conversationId: state.run.conversationId,
        interaction: {
          id: runInteraction.id,
          conversationId: state.run.conversationId,
          runId: state.run.runId,
          executionId: state.run.executionId,
          suspensionId: suspensionId(runInteraction.checkpointId),
          checkpointId: runInteraction.checkpointId,
          toolCallId: toolCall.id,
          toolCallRevision: toolCall.revision,
          interaction: toolInteraction,
        },
      });
    }
    for (const checkpointId of checkpointIds) {
      const members = state.interactions.filter(
        (interaction) => interaction.checkpointId === checkpointId,
      );
      const orderedIds =
        members[0]?.batchToolCallIds ??
        members.map((interaction) => interaction.toolCallId);
      const ordered = orderedIds.flatMap((toolCallId) => {
        const interaction = members.find(
          (candidate) => candidate.toolCallId === toolCallId,
        );
        return interaction ? [interaction] : [];
      });
      if (ordered.length === 0) continue;
      events.push({
        kind: "suspension.upserted",
        conversationId: state.run.conversationId,
        suspension: {
          id: suspensionId(checkpointId),
          conversationId: state.run.conversationId,
          runId: state.run.runId,
          executionId: state.run.executionId,
          checkpointId,
          status: ordered.some(
            (interaction) => interaction.status === "pending",
          )
            ? "open"
            : "resolved",
          members: ordered.map((interaction, ordinal) => ({
            ordinal,
            interactionId: interaction.id,
            toolCallId: interaction.toolCallId,
            toolCallRevision:
              journalState.toolCalls.get(interaction.toolCallId)?.revision ??
              interaction.toolCallRevision,
            kind: interaction.kind,
          })),
          createdAt: ordered[0]!.createdAt,
          updatedAt: state.run.updatedAt,
        },
      });
    }
    return events;
  }

  private async scanMetadata(): Promise<RunRecord[]> {
    const records: RunRecord[] = [];
    for (const state of await this.journal.hydrateAll()) {
      for (const projection of state.runProjections.values()) {
        records.push(projection.run);
      }
    }
    return records.sort((left, right) =>
      left.updatedAt.localeCompare(right.updatedAt),
    );
  }

  private async hydrate(runId: string): Promise<RunHydratedState | undefined> {
    for (const state of await this.journal.hydrateAll()) {
      const hydrated = this.reduceFromJournal(state, runId);
      if (hydrated) return hydrated;
    }
    return undefined;
  }

  private reduceFromJournal(
    state: Awaited<ReturnType<ConversationJournalRepository["load"]>>,
    runId: string,
  ): RunHydratedState | undefined {
    return state.runProjections.get(runId);
  }

  private async exclusive<T>(
    runId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(runId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(action);
    const tail = task.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(runId, tail);
    try {
      return await task;
    } finally {
      if (this.locks.get(runId) === tail) this.locks.delete(runId);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function suspensionId(checkpointId: string): string {
  return `suspension_${checkpointId.slice("checkpoint_".length)}`;
}
