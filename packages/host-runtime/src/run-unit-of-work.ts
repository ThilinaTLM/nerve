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
  list(): Promise<readonly RunHydratedState[]>;
  /** Appends and fsyncs one authoritative transition after revision validation. */
  commit(
    expectedRevision: number,
    transition: RunTransitionRecord,
  ): Promise<void>;
  pendingEventIntents(): Promise<
    readonly {
      runId: string;
      revision: number;
      intent: RunPublicEventIntent;
    }[]
  >;
  markEventDelivered(delivery: RunEventDeliveryRecord): Promise<void>;
  materialize(runId: string): Promise<void>;
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

export class RunEventDeliveryService {
  constructor(
    private readonly unitOfWork: RunUnitOfWorkPort,
    private readonly publisher: IdempotentRunEventPublisherPort,
    private readonly now: () => string,
  ) {}

  async flush(): Promise<void> {
    for (const pending of await this.unitOfWork.pendingEventIntents()) {
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
  }
}

export function reduceRunTransitions(
  transitions: readonly RunTransitionRecord[],
  deliveries: readonly RunEventDeliveryRecord[] = [],
): RunHydratedState | undefined {
  if (transitions.length === 0) return undefined;
  const ordered = [...transitions].sort(
    (left, right) =>
      left.revision - right.revision ||
      left.transitionId.localeCompare(right.transitionId),
  );
  let revision = 0;
  const prompts = new Map<string, RunPromptRecord>();
  const interactions = new Map<string, RunInteractionRecord>();
  const checkpoints = new Map<string, RunCheckpointRecord>();
  for (const transition of ordered) {
    if (
      transition.previousRevision !== revision ||
      transition.revision !== revision + 1 ||
      transition.run.revision !== transition.revision
    ) {
      throw new RunRevisionConflictError(
        `Invalid transition lineage for ${transition.runId} at revision ${transition.revision}`,
      );
    }
    revision = transition.revision;
    for (const prompt of transition.prompts) prompts.set(prompt.id, prompt);
    for (const interaction of transition.interactions)
      interactions.set(interaction.id, interaction);
    for (const checkpoint of transition.checkpoints)
      checkpoints.set(checkpoint.checkpointId, checkpoint);
  }
  const latest = ordered.at(-1)!;
  return {
    run: latest.run,
    prompts: [...prompts.values()].sort(
      (left, right) => left.ordinal - right.ordinal,
    ),
    interactions: [...interactions.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    ),
    checkpoints: [...checkpoints.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    ),
    transitions: ordered,
    deliveries: [...deliveries],
  };
}
