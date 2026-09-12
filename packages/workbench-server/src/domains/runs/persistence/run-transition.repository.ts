import type { ConversationJournalEvent } from "@nervekit/contracts/conversations";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import type {
  ExecutionAttempt,
  LifecycleInteraction,
  RunEventDeliveryRecord,
  RunLifecycleRecord,
  RunRecord,
  RunTransitionRecord,
  ToolProposal,
} from "@nervekit/contracts/runs";
import {
  runEventDeliveryRecordSchema,
  runTransitionRecordSchema,
} from "@nervekit/contracts/runs";
import { storagePaths } from "../../../infrastructure/storage-bootstrap/paths.js";
import { ConversationJournalRepository } from "../../conversations/conversation-journal.repository.js";
import { WorkbenchRunIntegrity } from "../adapters/workbench-run-integrity.js";
import {
  ACTIVE_STATUSES,
  ActiveRunLookup,
  applyRunEventDelivery,
  applyRunTransition,
  BoundedRunStateCache,
  deliverySettledIntentId,
  RunRevisionConflictError,
  type RunHydratedState,
  type RunUnitOfWorkPort,
} from "../runtime/index.js";

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
  private readonly integrity = new WorkbenchRunIntegrity();
  private readonly refreshJournalReads: boolean;

  constructor(
    journalOrHome: ConversationJournalRepository | string,
    cacheMaximum = 32,
  ) {
    if (typeof journalOrHome === "string") {
      this.refreshJournalReads = true;
      this.journal = new ConversationJournalRepository({
        paths: storagePaths(journalOrHome),
      });
    } else {
      this.refreshJournalReads = false;
      this.journal = journalOrHome;
    }
    this.cache = new BoundedRunStateCache(cacheMaximum);
  }

  async load(runId: string): Promise<RunHydratedState | undefined> {
    const cached = this.refreshJournalReads ? undefined : this.cache.get(runId);
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
    for (const record of await this.scanMetadata()) {
      const cached = this.refreshJournalReads
        ? undefined
        : this.cache.get(record.runId);
      const state = cached ?? (await this.hydrate(record.runId));
      if (!state) continue;
      if (!cached && ACTIVE_STATUSES.has(state.run.status)) {
        this.cache.set(state);
      }
      this.lookup.observe(state);
      states.push(state);
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
    const interaction = [
      ...(journalState.interactionIdsByToolCall.get(toolCallId) ?? []),
    ]
      .map((id) => journalState.interactions.get(id))
      .find(
        (candidate) =>
          candidate?.runId === runId &&
          candidate.executionId === runState.run.executionId &&
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
    const active = await this.journal.listRunStates<RunHydratedState>([
      ...ACTIVE_STATUSES,
    ]);
    for (const state of active) {
      this.cache.set(state);
      this.lookup.observe(state);
    }
    this.lookup.markInitialized();
  }

  async commit(
    expectedRevision: number,
    transition: RunTransitionRecord,
    lifecycleWork: readonly import("@nervekit/contracts/runs").LifecycleWork[] = [],
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
      const aggregate = await this.lifecycleAggregate(next, parsed);
      await this.journal.commit(parsed.run.conversationId, {
        kind: `run.${parsed.kind}`,
        committedAt: parsed.committedAt,
        events,
        idempotencyKey: parsed.transitionId,
        lifecycle: {
          aggregate,
          work: lifecycleWork,
          inputHash: parsed.checksum,
          outcome: { transitionId: parsed.transitionId },
        },
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
    const candidates =
      await this.journal.listRunDeliveryRecoveryStates<RunHydratedState>();
    for (const state of candidates) {
      const delivered = new Set(state.deliveries.map((item) => item.intentId));
      const runPending = state.transitions.flatMap((transition) =>
        transition.events
          .filter((intent) => !delivered.has(intent.id))
          .map((intent) => ({
            runId: transition.runId,
            revision: transition.revision,
            intent,
          })),
      );
      if (runPending.length === 0) {
        await this.markDeliverySettled(state.run.runId, state.run.revision);
        continue;
      }

      const journalState = await this.journal.load(state.run.conversationId);
      for (const item of runPending) {
        const conversationRevision =
          journalState.intentConversationRevisions.get(item.intent.id);
        pending.push({
          ...item,
          intent:
            conversationRevision === undefined || !isRecord(item.intent.data)
              ? item.intent
              : {
                  ...item.intent,
                  data: { ...item.intent.data, conversationRevision },
                },
        });
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

  private async lifecycleAggregate(
    state: RunHydratedState,
    transition: RunTransitionRecord,
  ): Promise<{
    run: RunLifecycleRecord;
    proposals: ToolProposal[];
    interactions: LifecycleInteraction[];
    attempts: ExecutionAttempt[];
    recoveryIssues: [];
  }> {
    const journalState = await this.journal.load(state.run.conversationId);
    const proposalById = new Map<string, ToolProposal>();
    const interactions: LifecycleInteraction[] = [];
    const attempts: ExecutionAttempt[] = [];
    for (const interaction of state.interactions) {
      const toolCall = journalState.toolCalls.get(interaction.toolCallId);
      const toolInteraction =
        toolCall?.interactions[interaction.interactionOrdinal];
      if (!toolCall || !toolInteraction) continue;
      const checkpoint = state.checkpoints.find(
        (candidate) => candidate.checkpointId === interaction.checkpointId,
      );
      proposalById.set(toolCall.id, {
        id: toolCall.id,
        conversationId: toolCall.conversationId,
        projectId: toolCall.projectId,
        agentId: toolCall.agentId,
        runId: interaction.runId,
        executionId: interaction.executionId,
        batchId: interaction.checkpointId,
        toolName: toolCall.toolName,
        providerToolCallId:
          toolCall.providerToolCallId ??
          toolCall.sourceToolCallId ??
          toolCall.id,
        argumentsHash: this.integrity.checksum(toolCall.args),
        contextFingerprint: this.integrity.checksum({
          checkpointId: interaction.checkpointId,
          checkpointChecksum: checkpoint?.checksum,
          toolCallRevision: interaction.toolCallRevision,
        }),
        replayCapability: replayCapability(toolCall),
        createdAt: toolCall.createdAt,
      });
      interactions.push({
        id: interaction.id,
        proposalId: toolCall.id,
        runId: interaction.runId,
        kind: interaction.kind,
        status: interaction.status,
        request: { ...toolInteraction.request },
        ...(interaction.resolution
          ? { resolution: interaction.resolution }
          : {}),
        ...(interaction.resolutionRequestId
          ? { resolutionRequestId: interaction.resolutionRequestId }
          : {}),
        ...(interaction.resolutionHash
          ? { resolutionHash: interaction.resolutionHash }
          : {}),
        requestedAt: interaction.createdAt,
        ...(interaction.resolvedAt
          ? { resolvedAt: interaction.resolvedAt }
          : {}),
        ...(interaction.cancelledAt
          ? { cancelledAt: interaction.cancelledAt }
          : {}),
      });
      if (toolCall.execution) {
        attempts.push(
          executionAttempt(
            toolCall,
            state.transitions.flatMap((item) => item.entries),
          ),
        );
      }
    }
    const run: RunLifecycleRecord = {
      runId: transition.runId,
      conversationId: transition.run.conversationId,
      projectId: transition.run.projectId,
      agentId: transition.run.agentId,
      branchEpoch: transition.stateEpoch,
      revision: transition.revision,
      state: terminalLifecycleState(transition.run),
      ...(state.interactions.find((item) => item.status === "pending")
        ? {
            currentBatchId: state.interactions.find(
              (item) => item.status === "pending",
            )!.checkpointId,
          }
        : {}),
      ...(transition.run.executionId
        ? { currentModelAttemptId: transition.run.executionId }
        : {}),
      createdAt: transition.run.createdAt,
      updatedAt: transition.run.updatedAt,
      ...(transition.run.terminalAt
        ? { terminalAt: transition.run.terminalAt }
        : {}),
    };
    return {
      run,
      proposals: [...proposalById.values()],
      interactions,
      attempts,
      recoveryIssues: [],
    };
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
    return (await this.journal.listRunMetadata()).sort((left, right) =>
      left.updatedAt.localeCompare(right.updatedAt),
    );
  }

  private async hydrate(runId: string): Promise<RunHydratedState | undefined> {
    return this.journal.readRunState<RunHydratedState>(runId);
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

function terminalLifecycleState(run: RunRecord): RunLifecycleRecord["state"] {
  return ["completed", "failed", "cancelled"].includes(run.status)
    ? (run.status as RunLifecycleRecord["state"])
    : "open";
}

function replayCapability(
  toolCall: ToolCallRecord,
): ToolProposal["replayCapability"] {
  if (toolCall.execution?.hostHandle) return "reattach_or_query";
  if (toolCall.risk === "read") return "safe_replay";
  return "non_replayable";
}

function executionAttempt(
  toolCall: ToolCallRecord,
  entries: readonly import("@nervekit/contracts/conversations").ConversationEntry[],
): ExecutionAttempt {
  const resultEntryId = entries.find(
    (entry) =>
      (entry.details as { toolRecordId?: string } | undefined)?.toolRecordId ===
      toolCall.id,
  )?.id;
  const state: ExecutionAttempt["state"] =
    toolCall.status === "completed"
      ? "completed"
      : toolCall.status === "failed"
        ? "failed"
        : toolCall.status === "cancelled" || toolCall.status === "denied"
          ? "cancelled"
          : toolCall.status === "running"
            ? "running"
            : "ready";
  return {
    id: `attempt_${toolCall.id.slice("tool_".length)}_${toolCall.attempt}`,
    proposalId: toolCall.id,
    runId: toolCall.runId!,
    generation: toolCall.attempt,
    state,
    ...(resultEntryId ? { resultEntryId } : {}),
    ...(toolCall.resultPayload
      ? { resultRef: toolCall.resultPayload.logicalPath }
      : {}),
    ...(toolCall.execution?.hostHandle
      ? { externalLocator: toolCall.execution.hostHandle }
      : {}),
    startedAt: toolCall.execution!.startedAt,
    ...(toolCall.settledAt ? { settledAt: toolCall.settledAt } : {}),
  };
}

function suspensionId(checkpointId: string): string {
  return `suspension_${checkpointId.slice("checkpoint_".length)}`;
}
