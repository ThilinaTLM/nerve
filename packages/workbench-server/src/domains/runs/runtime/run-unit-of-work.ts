import type {
  RunCheckpointRecord,
  RunEventDeliveryRecord,
  RunInteractionRecord,
  RunPromptRecord,
  RunPublicEventIntent,
  RunRecord,
  RunTransitionRecord,
} from "@nervekit/contracts";

export interface RunHydratedState {
  readonly run: RunRecord;
  readonly prompts: readonly RunPromptRecord[];
  readonly interactions: readonly RunInteractionRecord[];
  readonly checkpoints: readonly RunCheckpointRecord[];
  readonly transitions: readonly RunTransitionRecord[];
  readonly deliveries: readonly RunEventDeliveryRecord[];
}

export interface RunUnitOfWorkPort {
  load(runId: string): Promise<RunHydratedState | undefined>;
  findActive(scopeId: string): Promise<RunHydratedState | undefined>;
  /** Loads only currently-active runs without hydrating terminal history. */
  listActive(): Promise<readonly RunHydratedState[]>;
  /** Resolves the active run containing the interaction, if any. */
  findByInteractionId(
    interactionId: string,
  ): Promise<RunHydratedState | undefined>;
  /** Resolves the active run whose interaction carries the tool call. */
  findByInteractionToolCallId(
    toolCallId: string,
  ): Promise<RunHydratedState | undefined>;
  /** Resolves the active run containing the prompt, if any. */
  findByPromptId(promptId: string): Promise<RunHydratedState | undefined>;
  /**
   * Enumerates and hydrates every run, including terminal history. Reserved
   * for boot recovery, event-delivery recovery, status rebuilds, and explicit
   * historical queries; hot paths must use the targeted reads above.
   */
  list(): Promise<readonly RunHydratedState[]>;
  /** Appends and fsyncs one authoritative transition after revision validation. */
  commit(
    expectedRevision: number,
    transition: RunTransitionRecord,
  ): Promise<RunHydratedState>;
  pendingEventIntents(): Promise<
    readonly {
      runId: string;
      revision: number;
      intent: RunPublicEventIntent;
    }[]
  >;
  markEventDelivered(delivery: RunEventDeliveryRecord): Promise<void>;
  materialize(state: RunHydratedState): Promise<void>;
}

export interface RunTransitionObserverPort {
  /** Called only after the authoritative transition commit succeeds. */
  committed(transition: RunTransitionRecord): Promise<void>;
}

export interface IdempotentRunEventPublisherPort {
  publish(intent: RunPublicEventIntent): Promise<{
    eventId: string;
    sequence: number;
  }>;
}

export interface RunCheckpointReferencePort {
  stateEpoch(): number;
  transcript(runId: string): Promise<{
    cursor: number;
    entryIds: readonly string[];
    harnessLeafId: string | null;
    harnessSavePointId: string;
  }>;
  toolCalls(runId: string): Promise<
    readonly {
      toolCallId: string;
      lifecycleRevision: number;
      status: string;
    }[]
  >;
  interaction(interactionId: string): Promise<RunInteractionRecord | undefined>;
}

export class RunRevisionConflictError extends Error {
  readonly code = "RUN_REVISION_CONFLICT";
}

interface PendingRunEventIntent {
  readonly runId: string;
  readonly revision: number;
  readonly intent: RunPublicEventIntent;
}

export class RunEventDeliveryService {
  private tail: Promise<void> = Promise.resolve();
  private recoveryRequired = false;

  constructor(
    private readonly unitOfWork: RunUnitOfWorkPort,
    private readonly publisher: IdempotentRunEventPublisherPort,
    private readonly now: () => string,
  ) {}

  /**
   * Waits for every queued delivery to settle without initiating new work.
   * Used by host shutdown to reach write quiescence deterministically.
   */
  settled(): Promise<void> {
    return this.tail;
  }

  /** Performs the all-run recovery sweep. */
  flush(): Promise<void> {
    return this.serialized(async () => {
      try {
        await this.flushPending();
        this.recoveryRequired = false;
      } catch (error) {
        this.recoveryRequired = true;
        throw error;
      }
    });
  }

  /** Delivers only one committed transition on the healthy hot path. */
  flushTransition(transition: RunTransitionRecord): Promise<void> {
    return this.serialized(async () => {
      try {
        if (this.recoveryRequired) {
          await this.flushPending();
          this.recoveryRequired = false;
          return;
        }
        const state = await this.unitOfWork.load(transition.runId);
        const delivered = new Set(
          state?.deliveries.map((delivery) => delivery.intentId),
        );
        for (const intent of transition.events) {
          if (delivered.has(intent.id)) continue;
          await this.deliver({
            runId: transition.runId,
            revision: transition.revision,
            intent,
          });
          delivered.add(intent.id);
        }
      } catch (error) {
        this.recoveryRequired = true;
        throw error;
      }
    });
  }

  private async flushPending(): Promise<void> {
    const failedRuns = new Set<string>();
    const failures: unknown[] = [];
    for (const pending of await this.unitOfWork.pendingEventIntents()) {
      if (failedRuns.has(pending.runId)) continue;
      try {
        await this.deliver(pending);
      } catch (error) {
        failedRuns.add(pending.runId);
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      const firstFailure = failures[0];
      const detail =
        firstFailure instanceof Error
          ? firstFailure.message
          : String(firstFailure);
      throw new AggregateError(
        failures,
        `Event delivery recovery failed for ${failedRuns.size} run(s): ${detail}`,
      );
    }
  }

  private async deliver(pending: PendingRunEventIntent): Promise<void> {
    const published = await this.publisher.publish(pending.intent);
    await this.unitOfWork.markEventDelivered({
      intentId: pending.intent.id,
      runId: pending.runId,
      revision: pending.revision,
      eventId: published.eventId,
      sequence: published.sequence,
      deliveredAt: this.now(),
    });
  }

  private serialized(action: () => Promise<void>): Promise<void> {
    const result = this.tail.catch(() => undefined).then(action);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export class BoundedRunStateCache {
  private readonly entries = new Map<string, RunHydratedState>();

  constructor(private readonly maximum = 32) {
    if (!Number.isInteger(maximum) || maximum < 0) {
      throw new RangeError("Run state cache maximum must be nonnegative");
    }
  }

  get(runId: string): RunHydratedState | undefined {
    const state = this.entries.get(runId);
    if (!state) return undefined;
    this.entries.delete(runId);
    this.entries.set(runId, state);
    return state;
  }

  set(state: RunHydratedState): void {
    if (this.maximum === 0) return;
    const runId = state.run.runId;
    this.entries.delete(runId);
    this.entries.set(runId, state);
    while (this.entries.size > this.maximum) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export function applyRunTransition(
  state: RunHydratedState | undefined,
  transition: RunTransitionRecord,
): RunHydratedState {
  const previousRevision = state?.run.revision ?? 0;
  const runId = state?.run.runId ?? transition.runId;
  if (
    transition.runId !== runId ||
    transition.run.runId !== runId ||
    transition.previousRevision !== previousRevision ||
    transition.revision !== previousRevision + 1 ||
    transition.run.revision !== transition.revision
  ) {
    throw new RunRevisionConflictError(
      `Invalid transition lineage for ${transition.runId} at revision ${transition.revision}`,
    );
  }

  const prompts = new Map(
    state?.prompts.map((prompt) => [prompt.id, prompt] as const),
  );
  const interactions = new Map(
    state?.interactions.map(
      (interaction) => [interaction.id, interaction] as const,
    ),
  );
  const checkpoints = new Map(
    state?.checkpoints.map(
      (checkpoint) => [checkpoint.checkpointId, checkpoint] as const,
    ),
  );
  for (const prompt of transition.prompts) prompts.set(prompt.id, prompt);
  for (const interaction of transition.interactions) {
    interactions.set(interaction.id, interaction);
  }
  for (const checkpoint of transition.checkpoints) {
    checkpoints.set(checkpoint.checkpointId, checkpoint);
  }

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
    transitions: [...(state?.transitions ?? []), transition],
    deliveries: state?.deliveries ?? [],
  };
}

export function applyRunEventDelivery(
  state: RunHydratedState,
  delivery: RunEventDeliveryRecord,
): RunHydratedState {
  if (delivery.runId !== state.run.runId) {
    throw new Error(
      `Delivery ${delivery.intentId} does not belong to run ${state.run.runId}`,
    );
  }
  const existing = state.deliveries.find(
    (candidate) => candidate.intentId === delivery.intentId,
  );
  if (existing) {
    if (!sameDelivery(existing, delivery)) {
      throw new Error(`Conflicting event delivery: ${delivery.intentId}`);
    }
    return state;
  }
  return { ...state, deliveries: [...state.deliveries, delivery] };
}

export function reduceRunTransitions(
  transitions: readonly RunTransitionRecord[],
  deliveries: readonly RunEventDeliveryRecord[] = [],
): RunHydratedState | undefined {
  const ordered = [...transitions].sort(
    (left, right) =>
      left.revision - right.revision ||
      left.transitionId.localeCompare(right.transitionId),
  );
  let state: RunHydratedState | undefined;
  for (const transition of ordered) {
    state = applyRunTransition(state, transition);
  }
  if (!state) return undefined;
  for (const delivery of deliveries) {
    state = applyRunEventDelivery(state, delivery);
  }
  return state;
}

function sameDelivery(
  left: RunEventDeliveryRecord,
  right: RunEventDeliveryRecord,
): boolean {
  // A retry can observe the same idempotent publication at a later time.
  // deliveredAt records the marker attempt, not the publication identity.
  return (
    left.intentId === right.intentId &&
    left.runId === right.runId &&
    left.revision === right.revision &&
    left.eventId === right.eventId &&
    left.sequence === right.sequence
  );
}
