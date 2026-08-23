import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rm, truncate } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConversationTreeEntry } from "@nervekit/harness";
import {
  CONVERSATION_JOURNAL_EPOCH,
  conversationJournalCommitSchema,
  type ConversationEntry,
  type ConversationInteractionRecord,
  type ConversationJournalCommit,
  type ConversationJournalEvent,
  type ConversationRecord,
  type ConversationSuspensionRecord,
  type RunCheckpointRecord,
  type RunEventDeliveryRecord,
  type RunInteractionRecord,
  type RunPromptRecord,
  type RunRecord,
  type RunTransitionRecord,
  type ToolCallRecord,
} from "@nervekit/contracts";

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
  private readonly locks = journalLocks;

  constructor(private readonly storage: { paths: { home: string } }) {}

  homePath(): string {
    return this.storage.paths.home;
  }

  unload(conversationId: string): void {
    this.states.delete(conversationId);
  }

  journalPath(conversationId: string): string {
    return join(
      this.storage.paths.home,
      "conversations",
      conversationId,
      "journal.jsonl",
    );
  }

  async hydrateAll(): Promise<ConversationJournalState[]> {
    const root = join(this.storage.paths.home, "conversations");
    const directories = await readdir(root, { withFileTypes: true }).catch(
      () => [],
    );
    const states: ConversationJournalState[] = [];
    for (const directory of directories.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (!directory.isDirectory() || !directory.name.startsWith("conv_")) {
        continue;
      }
      const state = await this.load(directory.name);
      if (state.revision > 0) states.push(state);
    }
    return states;
  }

  async load(conversationId: string): Promise<ConversationJournalState> {
    return this.states.get(conversationId) ?? this.loadFresh(conversationId);
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
    const interaction = [...state.interactions.values()].find(
      (candidate) =>
        candidate.runId === toolCall.runId &&
        candidate.toolCallId === toolCall.id &&
        candidate.interaction.ordinal === ordinal,
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
      const state = await this.loadFresh(conversationId);
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
      const candidate = cloneState(state);
      for (const event of input.events) {
        validateEventReferences(candidate, event, conversationId);
        applyEvent(candidate, event);
      }
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
      const next = cloneState(state);
      applyCommit(next, parsed);
      const path = this.journalPath(conversationId);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const handle = await open(path, "a", 0o600);
      try {
        await handle.write(`${JSON.stringify(parsed)}\n`, undefined, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      this.states.set(conversationId, next);
      return parsed;
    });
  }

  async remove(conversationId: string): Promise<void> {
    await this.exclusive(conversationId, async () => {
      this.states.delete(conversationId);
      await rm(dirname(this.journalPath(conversationId)), {
        recursive: true,
        force: true,
      });
    });
  }

  private async loadFresh(
    conversationId: string,
  ): Promise<ConversationJournalState> {
    const path = this.journalPath(conversationId);
    const state = emptyState(conversationId);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        this.states.set(conversationId, state);
        return state;
      }
      throw error;
    }
    // Every committed record is newline-terminated. A non-terminated suffix is
    // an interrupted append even when its JSON happens to be parseable.
    if (raw.length > 0 && !raw.endsWith("\n")) {
      const completeBytes = raw.lastIndexOf("\n") + 1;
      await truncate(path, Buffer.byteLength(raw.slice(0, completeBytes)));
      raw = raw.slice(0, completeBytes);
    }
    const lines = raw.split("\n");
    let consumedBytes = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const bytes = Buffer.byteLength(`${line}\n`);
      if (!line.trim()) {
        consumedBytes += bytes;
        continue;
      }
      let commit: ConversationJournalCommit;
      try {
        const decoded = JSON.parse(line) as unknown;
        commit = conversationJournalCommitSchema.parse(decoded);
      } catch (error) {
        const isFinalRecord = index === lines.length - 1;
        if (!isFinalRecord) {
          throw new Error(
            `Conversation journal '${conversationId}' is corrupt at line ${index + 1}.`,
            { cause: error },
          );
        }
        await truncate(path, consumedBytes);
        break;
      }
      verifyCommit(state, commit);
      applyCommit(state, commit);
      consumedBytes += bytes;
    }
    this.states.set(conversationId, state);
    return state;
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
  if (commit.conversationId !== state.conversationId) {
    throw new Error("Conversation journal commit identity mismatch.");
  }
  if (
    commit.previousRevision !== state.revision ||
    commit.revision !== state.revision + 1
  ) {
    throw new Error("Conversation journal revision chain is invalid.");
  }
  if (commit.previousChecksum !== state.checksum) {
    throw new Error("Conversation journal checksum chain is invalid.");
  }
  const { checksum, ...base } = commit;
  if (journalChecksum(base) !== checksum) {
    throw new Error("Conversation journal commit checksum is invalid.");
  }
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

function validateEventReferences(
  state: ConversationJournalState,
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
      event.transition.run.conversationId !== conversationId)
  ) {
    throw new Error("Conversation journal record identity mismatch.");
  }
  if (event.kind === "interaction.upserted") {
    const toolCall = state.toolCalls.get(event.interaction.toolCallId);
    if (!toolCall || toolCall.revision !== event.interaction.toolCallRevision) {
      throw new Error("Conversation interaction tool revision is stale.");
    }
  }
  if (event.kind === "suspension.upserted") {
    for (const member of event.suspension.members) {
      const interaction = state.interactions.get(member.interactionId);
      if (
        !interaction ||
        interaction.suspensionId !== event.suspension.id ||
        interaction.checkpointId !== event.suspension.checkpointId ||
        interaction.toolCallId !== member.toolCallId ||
        interaction.toolCallRevision !== member.toolCallRevision
      ) {
        throw new Error("Conversation suspension member is inconsistent.");
      }
    }
  }
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
      const index = state.entries.findIndex(
        (entry) => entry.id === event.entry.id,
      );
      if (index === -1) state.entries.push(event.entry);
      else if (
        JSON.stringify(state.entries[index]) !== JSON.stringify(event.entry)
      ) {
        throw new Error(`Conflicting conversation entry '${event.entry.id}'.`);
      }
      return;
    }
    case "model_context.entry_appended": {
      const entry = event.entry as unknown as ConversationTreeEntry;
      const entries = event.ownerAgentId
        ? (state.agentModelEntries.get(event.ownerAgentId) ?? [])
        : state.modelEntries;
      const index = entries.findIndex((item) => item.id === entry.id);
      if (index === -1) entries.push(entry);
      else if (JSON.stringify(entries[index]) !== JSON.stringify(entry)) {
        throw new Error(`Conflicting model-context entry '${entry.id}'.`);
      }
      const leafId = entry.type === "leaf" ? entry.targetId : entry.id;
      if (event.ownerAgentId) {
        state.agentModelEntries.set(event.ownerAgentId, entries);
        state.agentModelLeafIds.set(event.ownerAgentId, leafId);
      } else {
        state.modelLeafId = leafId;
      }
      return;
    }
    case "model_context.leaf_changed":
      if (event.ownerAgentId) {
        state.agentModelLeafIds.set(event.ownerAgentId, event.entryId);
      } else {
        state.modelLeafId = event.entryId;
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
    case "interaction.upserted":
      state.interactions.set(event.interaction.id, event.interaction);
      return;
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
      compactRunProjection(projection);
    }
  }
}

function applyRunProjectionTransition(
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
  const projection: ConversationRunProjection = {
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
  compactRunProjection(projection);
  return projection;
}

function compactRunProjection(projection: ConversationRunProjection): void {
  const delivered = new Set(
    projection.deliveries.map((delivery) => delivery.intentId),
  );
  const latest = projection.transitions.at(-1);
  projection.transitions = projection.transitions.filter(
    (transition) =>
      transition === latest ||
      transition.events.some((intent) => !delivered.has(intent.id)),
  );
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
  };
}

function cloneState(state: ConversationJournalState): ConversationJournalState {
  return {
    ...state,
    entries: [...state.entries],
    modelEntries: [...state.modelEntries],
    agentModelEntries: new Map(
      [...state.agentModelEntries].map(([agentId, entries]) => [
        agentId,
        [...entries],
      ]),
    ),
    agentModelLeafIds: new Map(state.agentModelLeafIds),
    toolCalls: new Map(state.toolCalls),
    runProjections: new Map(
      [...state.runProjections].map(([runId, projection]) => [
        runId,
        {
          ...projection,
          prompts: [...projection.prompts],
          interactions: [...projection.interactions],
          checkpoints: [...projection.checkpoints],
          transitions: [...projection.transitions],
          deliveries: [...projection.deliveries],
        },
      ]),
    ),
    interactions: new Map(state.interactions),
    suspensions: new Map(state.suspensions),
    idempotencyKeys: new Map(state.idempotencyKeys),
    intentConversationRevisions: new Map(state.intentConversationRevisions),
  };
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
