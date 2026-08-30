import { createHash, randomUUID } from "node:crypto";
import type { PerformanceDiagnosticsPort } from "../../core/ports/diagnostics.js";
import { noopPerformanceDiagnostics } from "../../infrastructure/diagnostics/performance-metrics.js";
import {
  CanonicalStore,
  decode,
} from "../../infrastructure/persistence/canonical-sqlite/index.js";
import { storagePaths } from "../../infrastructure/storage-bootstrap/paths.js";
import {
  deserializeState,
  prepareConversationPersistenceDelta,
  serializeState,
  type ConversationPersistenceDelta,
  type SerializedConversationState,
} from "./conversation-state-materializer.js";
import {
  applyRunProjectionTransition,
  validateCommitEvents,
} from "./conversation-journal-validation.js";
import {
  ConversationTreeState,
  type ConversationTreeEntry,
} from "@nervekit/harness/conversation";
import {
  CONVERSATION_JOURNAL_EPOCH,
  conversationJournalCommitSchema,
  type ConversationEntry,
  type ConversationInteractionRecord,
  type ConversationJournalCommit,
  type ConversationJournalEvent,
  type ConversationRecord,
  type ConversationSuspensionRecord,
} from "@nervekit/contracts/conversations";
import {
  type RunCheckpointRecord,
  type RunEventDeliveryRecord,
  type RunInteractionRecord,
  type RunPromptRecord,
  type RunRecord,
  type RunTransitionRecord,
} from "@nervekit/contracts/runs";
import { type ToolCallRecord } from "@nervekit/contracts/tools";

export interface ConversationJournalState {
  conversationId: string;
  revision: number;
  checksum?: string;
  conversation?: ConversationRecord;
  entries: ConversationEntry[];
  modelEntries: ConversationTreeEntry[];
  modelLeafId: string | null;
  agentModelEntries: Map<string, ConversationTreeEntry[]>;
  agentModelLeafIds: Map<string, string | null>;
  toolCalls: Map<string, ToolCallRecord>;
  runProjections: Map<string, ConversationRunProjection>;
  interactions: Map<string, ConversationInteractionRecord>;
  suspensions: Map<string, ConversationSuspensionRecord>;
  idempotencyKeys: Map<string, ConversationJournalCommit>;
  intentConversationRevisions: Map<string, number>;
  /** Non-serialized indexes maintained with the resident projection. */
  entryById: Map<string, ConversationEntry>;
  modelEntryById: Map<string, ConversationTreeEntry>;
  agentModelEntryById: Map<string, Map<string, ConversationTreeEntry>>;
  interactionIdsByToolCall: Map<string, Set<string>>;
  interactionByToolCallOrdinal: Map<string, ConversationInteractionRecord>;
  modelTree: ConversationTreeState;
  agentModelTrees: Map<string, ConversationTreeState>;
}

export interface ConversationRunProjection {
  run: RunRecord;
  prompts: RunPromptRecord[];
  interactions: RunInteractionRecord[];
  checkpoints: RunCheckpointRecord[];
  transitions: RunTransitionRecord[];
  deliveries: RunEventDeliveryRecord[];
}

export class ConversationJournalRevisionConflictError extends Error {
  constructor(
    readonly conversationId: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `Conversation '${conversationId}' revision conflict: expected ${expected}, current ${actual}.`,
    );
    this.name = "ConversationJournalRevisionConflictError";
  }
}

/** Sole authoritative append-only store for conversation-owned domain state. */
const journalLocks = new Map<string, Promise<void>>();

export class ConversationJournalRepository {
  private readonly states = new Map<string, ConversationJournalState>();
  private readonly pendingLoads = new Map<
    string,
    Promise<ConversationJournalState>
  >();
  private readonly dirty = new Set<string>();
  private readonly encodedBytes = new Map<string, number>();
  private readonly locks = journalLocks;

  private readonly canonical: CanonicalStore;
  private readonly ready: Promise<void>;
  constructor(
    private readonly storage: {
      paths: { home: string; sqlitePath?: string };
      canonicalStore?: CanonicalStore;
    },
    private readonly diagnostics: PerformanceDiagnosticsPort = noopPerformanceDiagnostics,
    private readonly cacheOptions: {
      maxResidentConversations?: number;
      maxResidentEncodedBytes?: number;
    } = {},
  ) {
    this.canonical =
      storage.canonicalStore ??
      new CanonicalStore(
        storage.paths.sqlitePath ?? storagePaths(storage.paths.home).sqlitePath,
      );
    this.ready = this.canonical.initialize();
  }

  homePath(): string {
    return this.storage.paths.home;
  }

  unload(conversationId: string): void {
    if (this.dirty.has(conversationId)) return;
    this.states.delete(conversationId);
    this.encodedBytes.delete(conversationId);
  }

  async listConversationMetadata(): Promise<ConversationRecord[]> {
    await this.ready;
    return this.canonical.listConversationMetadata<ConversationRecord>();
  }

  async readConversationRevision(conversationId: string): Promise<number> {
    await this.ready;
    return this.canonical.readConversationRevision(conversationId);
  }

  async readConversationEntries(
    conversationId: string,
  ): Promise<ConversationEntry[]> {
    await this.ready;
    return this.canonical.readConversationEntries(conversationId);
  }

  async scanToolCalls(
    input: {
      afterId?: string;
      maxRows?: number;
      maxBytes?: number;
    } = {},
  ) {
    await this.ready;
    return this.canonical.scanToolCalls(input);
  }

  async readToolCall(toolCallId: string): Promise<ToolCallRecord | undefined> {
    await this.ready;
    return this.canonical.readToolCall(toolCallId);
  }

  async listRunMetadata(): Promise<RunRecord[]> {
    await this.ready;
    return this.canonical.listRunMetadata();
  }

  async listRunStates<T>(statuses: string[]): Promise<T[]> {
    await this.ready;
    return this.canonical.listRunStates<T>(statuses);
  }

  async readRunState<T>(runId: string): Promise<T | undefined> {
    await this.ready;
    return this.canonical.readRunState<T>(runId);
  }

  async backfillConversationRecordProjections(
    input: {
      afterId?: string;
      maxRows?: number;
    } = {},
  ) {
    await this.ready;
    return this.canonical.backfillConversationRecordProjections(input);
  }

  async backfillMissingProjections(): Promise<number> {
    let afterId: string | undefined;
    let inserted = 0;
    for (;;) {
      const page = await this.backfillConversationRecordProjections({
        ...(afterId ? { afterId } : {}),
        maxRows: 250,
      });
      inserted += page.inserted;
      if (page.done) return inserted;
      if (!page.nextCursor) {
        throw new Error("Conversation projection backfill did not advance.");
      }
      afterId = page.nextCursor;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  residentStats(): {
    residentCount: number;
    residentEncodedBytes: number;
    dirtyCount: number;
  } {
    return {
      residentCount: this.states.size,
      residentEncodedBytes: this.totalEncodedBytes(),
      dirtyCount: this.dirty.size,
    };
  }

  async hydrateAll(
    options: { fresh?: boolean } = {},
  ): Promise<ConversationJournalState[]> {
    await this.ready;
    const states: ConversationJournalState[] = [];
    const conversationIds = new Set(
      await this.canonical.listConversationJournalIds(),
    );
    for (const conversationId of [...conversationIds].sort()) {
      const state = options.fresh
        ? await this.loadFresh(conversationId)
        : await this.load(conversationId);
      if (state.revision > 0) states.push(state);
    }
    return states;
  }

  async load(conversationId: string): Promise<ConversationJournalState> {
    const resident = this.states.get(conversationId);
    if (resident) {
      this.touch(conversationId, resident);
      return resident;
    }
    const pending = this.pendingLoads.get(conversationId);
    if (pending) return pending;
    const loading = this.loadFresh(conversationId).finally(() => {
      if (this.pendingLoads.get(conversationId) === loading) {
        this.pendingLoads.delete(conversationId);
      }
    });
    this.pendingLoads.set(conversationId, loading);
    return loading;
  }

  state(conversationId: string): ConversationJournalState | undefined {
    return this.states.get(conversationId);
  }

  isActionableToolInteraction(
    toolCall: ToolCallRecord,
    ordinal: number,
  ): boolean {
    if (!toolCall.runId) return true;
    const state = this.states.get(toolCall.conversationId);
    if (!state) return false;
    const interaction = state.interactionByToolCallOrdinal.get(
      interactionOrdinalKey(toolCall.id, ordinal),
    );
    if (!interaction) return false;
    const suspension = state.suspensions.get(interaction.suspensionId);
    const member = suspension?.members.find(
      (candidate) => candidate.interactionId === interaction.id,
    );
    return Boolean(
      suspension?.status === "open" &&
      member &&
      interaction.interaction.status !== "cancelled" &&
      member.toolCallRevision === interaction.toolCallRevision &&
      toolCall.revision === interaction.toolCallRevision,
    );
  }

  listLoaded(): ConversationJournalState[] {
    return [...this.states.values()];
  }

  async commit(
    conversationId: string,
    input: {
      kind: string;
      events: ConversationJournalEvent[];
      committedAt?: string;
      idempotencyKey?: string;
    },
    expectedRevision?: number,
  ): Promise<ConversationJournalCommit> {
    return this.exclusive(conversationId, async () => {
      // The repository is the sole in-process writer and the conversation lock
      // serializes commits. Replaying the entire append-only journal here made
      // every tool lifecycle update O(journal size), which became seconds for
      // established conversations. A cold repository still replays once;
      // subsequent commits advance the validated in-memory projection.
      const state = await this.load(conversationId);
      if (input.idempotencyKey) {
        const existing = state.idempotencyKeys.get(input.idempotencyKey);
        if (existing) return existing;
      }
      const expected = expectedRevision ?? state.revision;
      if (state.revision !== expected) {
        throw new ConversationJournalRevisionConflictError(
          conversationId,
          expected,
          state.revision,
        );
      }
      const prepareStartedAt = performance.now();
      const preview = validateCommitEvents(state, input.events, conversationId);
      const base = {
        epoch: CONVERSATION_JOURNAL_EPOCH,
        conversationId,
        commitId: `commit_${randomUUID()}`,
        ...(input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : {}),
        revision: state.revision + 1,
        previousRevision: state.revision,
        previousChecksum: state.checksum,
        kind: input.kind,
        committedAt: input.committedAt ?? new Date().toISOString(),
        events: input.events,
      };
      const serializedBase = JSON.parse(JSON.stringify(base)) as typeof base;
      const normalized = conversationJournalCommitSchema.parse({
        ...serializedBase,
        checksum: `sha256:${"0".repeat(64)}`,
      });
      const normalizedBase = Object.fromEntries(
        Object.entries(normalized).filter(([key]) => key !== "checksum"),
      ) as Omit<ConversationJournalCommit, "checksum">;
      const parsed = conversationJournalCommitSchema.parse({
        ...normalizedBase,
        checksum: journalChecksum(normalizedBase),
      });
      const delta = prepareConversationPersistenceDelta(
        state,
        parsed,
        preview.runProjections,
      );
      this.diagnostics.duration(
        "conversation.commitPrepare",
        performance.now() - prepareStartedAt,
      );
      this.diagnostics.count("conversation.commitEvents", parsed.events.length);
      this.diagnostics.count(
        "conversation.commitRecords",
        delta.records.length,
      );
      const persistStartedAt = performance.now();
      await this.persistCommit(delta);
      this.diagnostics.duration(
        "conversation.commitPersist",
        performance.now() - persistStartedAt,
      );
      applyCommit(state, parsed);
      this.dirty.add(conversationId);
      this.encodedBytes.set(
        conversationId,
        (this.encodedBytes.get(conversationId) ?? 0) +
          Buffer.byteLength(JSON.stringify(parsed)),
      );
      this.touch(conversationId, state);
      return parsed;
    });
  }

  async remove(conversationId: string): Promise<void> {
    await this.exclusive(conversationId, async () => {
      this.states.delete(conversationId);
      this.dirty.delete(conversationId);
      this.encodedBytes.delete(conversationId);
      await this.canonical.deleteConversationState(conversationId);
    });
  }

  async loadFresh(conversationId: string): Promise<ConversationJournalState> {
    await this.ready;
    const stored = await this.canonical.readConversationJournal(conversationId);
    const state = stored.snapshot
      ? deserializeState(decode(stored.snapshot) as SerializedConversationState)
      : emptyState(conversationId);
    for (const value of stored.commits) {
      const commit = conversationJournalCommitSchema.parse(decode(value));
      verifyCommit(state, commit);
      applyCommit(state, commit);
    }
    if (
      stored.head &&
      (stored.head.revision !== state.revision ||
        stored.head.checksum !== state.checksum)
    ) {
      throw new Error(
        `Conversation journal '${conversationId}' does not match its head.`,
      );
    }
    this.encodedBytes.set(conversationId, stored.encodedBytes);
    this.touch(conversationId, state);
    await this.pruneResidents(conversationId);
    return state;
  }

  async checkpointLoaded(): Promise<void> {
    await this.ready;
    for (const conversationId of [...this.dirty]) {
      const state = this.states.get(conversationId);
      if (!state || state.revision === 0) continue;
      await this.checkpoint(conversationId, state);
    }
  }

  private async checkpoint(
    conversationId: string,
    state: ConversationJournalState,
  ): Promise<void> {
    const startedAt = performance.now();
    await this.canonical.checkpointConversationState(serializeState(state));
    this.dirty.delete(conversationId);
    this.diagnostics.duration(
      "conversation.checkpoint",
      performance.now() - startedAt,
    );
  }

  private touch(conversationId: string, state: ConversationJournalState): void {
    this.states.delete(conversationId);
    this.states.set(conversationId, state);
  }

  private async pruneResidents(exclude: string): Promise<void> {
    const maximum = Math.max(
      1,
      this.cacheOptions.maxResidentConversations ?? 4,
    );
    const maximumBytes = Math.max(
      1,
      this.cacheOptions.maxResidentEncodedBytes ?? 256 * 1024 * 1024,
    );
    while (
      this.states.size > maximum ||
      (this.states.size > 1 && this.totalEncodedBytes() > maximumBytes)
    ) {
      const candidate = [...this.states.entries()].find(
        ([conversationId]) =>
          conversationId !== exclude &&
          !this.pendingLoads.has(conversationId) &&
          !this.locks.has(conversationId),
      );
      if (!candidate) return;
      const [conversationId, state] = candidate;
      if (this.dirty.has(conversationId)) {
        await this.checkpoint(conversationId, state);
      }
      this.states.delete(conversationId);
      this.encodedBytes.delete(conversationId);
      this.diagnostics.count("conversation.residentEviction");
    }
  }

  private totalEncodedBytes(): number {
    let total = 0;
    for (const bytes of this.encodedBytes.values()) total += bytes;
    return total;
  }

  private async persistCommit(
    delta: ConversationPersistenceDelta,
  ): Promise<void> {
    await this.ready;
    await this.canonical.persistConversationCommit(delta);
  }
  private async exclusive<T>(
    conversationId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(conversationId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(action);
    const tail = task.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(conversationId, tail);
    try {
      return await task;
    } finally {
      if (this.locks.get(conversationId) === tail) {
        this.locks.delete(conversationId);
      }
    }
  }
}

export function journalChecksum(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function verifyCommit(
  state: ConversationJournalState,
  commit: ConversationJournalCommit,
): void {
  if (
    commit.epoch !== CONVERSATION_JOURNAL_EPOCH ||
    commit.conversationId !== state.conversationId ||
    commit.previousRevision !== state.revision ||
    commit.revision !== state.revision + 1 ||
    commit.previousChecksum !== state.checksum
  ) {
    throw new Error(
      `Conversation journal '${state.conversationId}' has an invalid commit chain.`,
    );
  }
  const base = Object.fromEntries(
    Object.entries(commit).filter(([key]) => key !== "checksum"),
  );
  if (journalChecksum(base) !== commit.checksum) {
    throw new Error(
      `Conversation journal '${state.conversationId}' has a checksum mismatch.`,
    );
  }
  validateCommitEvents(state, commit.events, state.conversationId);
}

function interactionOrdinalKey(toolCallId: string, ordinal: number): string {
  return `${toolCallId}:${ordinal}`;
}

function applyCommit(
  state: ConversationJournalState,
  commit: ConversationJournalCommit,
): void {
  for (const event of commit.events) applyEvent(state, event);
  if (commit.idempotencyKey) {
    state.idempotencyKeys.set(commit.idempotencyKey, commit);
  }
  for (const event of commit.events) {
    if (event.kind !== "run.transition_committed") continue;
    for (const intent of event.transition.events) {
      state.intentConversationRevisions.set(intent.id, commit.revision);
    }
  }
  state.revision = commit.revision;
  state.checksum = commit.checksum;
}

function applyEvent(
  state: ConversationJournalState,
  event: ConversationJournalEvent,
): void {
  switch (event.kind) {
    case "conversation.upserted":
      state.conversation = event.conversation;
      return;
    case "conversation.entry_appended": {
      if (!state.entryById.has(event.entry.id)) {
        state.entries.push(event.entry);
        state.entryById.set(event.entry.id, event.entry);
      }
      // Entry ids are the idempotency boundary for transcript materialization.
      // Concurrent writers can derive different presentation metadata for the
      // same durable message; the first committed representation wins.
      return;
    }
    case "model_context.entry_appended": {
      const incoming = event.entry as unknown as ConversationTreeEntry;
      const entries = event.ownerAgentId
        ? (state.agentModelEntries.get(event.ownerAgentId) ?? [])
        : state.modelEntries;
      const indexed = event.ownerAgentId
        ? (state.agentModelEntryById.get(event.ownerAgentId) ?? new Map())
        : state.modelEntryById;
      const entry =
        event.ownerAgentId &&
        incoming.type === "compaction" &&
        incoming.parentId !== null &&
        !indexed.has(incoming.parentId)
          ? { ...incoming, parentId: null }
          : incoming;
      const previous = indexed.get(entry.id);
      if (!previous) {
        entries.push(entry);
        indexed.set(entry.id, entry);
        if (event.ownerAgentId) {
          const tree =
            state.agentModelTrees.get(event.ownerAgentId) ??
            new ConversationTreeState();
          tree.append(entry);
          state.agentModelTrees.set(event.ownerAgentId, tree);
        } else {
          state.modelTree.append(entry);
        }
      } else if (JSON.stringify(previous) !== JSON.stringify(entry)) {
        throw new Error(`Conflicting model-context entry '${entry.id}'.`);
      }
      const leafId = entry.type === "leaf" ? entry.targetId : entry.id;
      if (event.ownerAgentId) {
        state.agentModelEntries.set(event.ownerAgentId, entries);
        state.agentModelEntryById.set(event.ownerAgentId, indexed);
        state.agentModelLeafIds.set(event.ownerAgentId, leafId);
      } else {
        state.modelLeafId = leafId;
      }
      return;
    }
    case "model_context.leaf_changed":
      if (event.ownerAgentId) {
        state.agentModelLeafIds.set(event.ownerAgentId, event.entryId);
        const tree =
          state.agentModelTrees.get(event.ownerAgentId) ??
          new ConversationTreeState();
        tree.setLeafId(event.entryId);
        state.agentModelTrees.set(event.ownerAgentId, tree);
      } else {
        state.modelLeafId = event.entryId;
        state.modelTree.setLeafId(event.entryId);
      }
      return;
    case "tool_call.upserted": {
      const previous = state.toolCalls.get(event.toolCall.id);
      if (previous && event.toolCall.revision < previous.revision) {
        throw new Error(
          `Tool-call revision moved backwards for '${event.toolCall.id}'.`,
        );
      }
      state.toolCalls.set(event.toolCall.id, event.toolCall);
      return;
    }
    case "run.transition_committed": {
      const previous = state.runProjections.get(event.transition.runId);
      if (event.transition.previousRevision !== (previous?.run.revision ?? 0)) {
        throw new Error(
          `Run transition chain is invalid for '${event.transition.runId}'.`,
        );
      }
      state.runProjections.set(
        event.transition.runId,
        applyRunProjectionTransition(previous, event.transition),
      );
      return;
    }
    case "interaction.upserted": {
      const previous = state.interactions.get(event.interaction.id);
      if (previous) {
        state.interactionIdsByToolCall
          .get(previous.toolCallId)
          ?.delete(previous.id);
        state.interactionByToolCallOrdinal.delete(
          interactionOrdinalKey(
            previous.toolCallId,
            previous.interaction.ordinal,
          ),
        );
      }
      state.interactions.set(event.interaction.id, event.interaction);
      const ids =
        state.interactionIdsByToolCall.get(event.interaction.toolCallId) ??
        new Set<string>();
      ids.add(event.interaction.id);
      state.interactionIdsByToolCall.set(event.interaction.toolCallId, ids);
      state.interactionByToolCallOrdinal.set(
        interactionOrdinalKey(
          event.interaction.toolCallId,
          event.interaction.interaction.ordinal,
        ),
        event.interaction,
      );
      return;
    }
    case "suspension.upserted":
      state.suspensions.set(event.suspension.id, event.suspension);
      return;
    case "run.event_delivered": {
      const projection = state.runProjections.get(event.delivery.runId);
      if (!projection) {
        throw new Error(
          `Run delivery '${event.delivery.intentId}' has no run projection.`,
        );
      }
      const existing = projection.deliveries.find(
        (delivery) => delivery.intentId === event.delivery.intentId,
      );
      if (!existing) projection.deliveries.push(event.delivery);
    }
  }
}

function emptyState(conversationId: string): ConversationJournalState {
  return {
    conversationId,
    revision: 0,
    entries: [],
    modelEntries: [],
    modelLeafId: null,
    agentModelEntries: new Map(),
    agentModelLeafIds: new Map(),
    toolCalls: new Map(),
    runProjections: new Map(),
    interactions: new Map(),
    suspensions: new Map(),
    idempotencyKeys: new Map(),
    intentConversationRevisions: new Map(),
    entryById: new Map(),
    modelEntryById: new Map(),
    agentModelEntryById: new Map(),
    interactionIdsByToolCall: new Map(),
    interactionByToolCallOrdinal: new Map(),
    modelTree: new ConversationTreeState(),
    agentModelTrees: new Map(),
  };
}
