import { randomUUID } from "node:crypto";
import type {
  CanonicalConversationEntry,
  CanonicalEntryKind,
  ConversationHead,
  ConversationTransition,
  ConversationTransitionKind,
} from "@nervekit/contracts/conversations";

export interface AppendEntryDraft {
  entryId?: string;
  kind: CanonicalEntryKind;
  inlineContent?: unknown;
  artifacts?: CanonicalConversationEntry["artifacts"];
  runId?: string;
  toolCallId?: string;
  interactionId?: string;
  provenance?: Record<string, unknown>;
}

interface TransitionIdentity {
  commandId: string;
  inputFingerprint: string;
  actor: Record<string, unknown>;
  cause: Record<string, unknown>;
  committedAt: string;
  transitionId?: string;
}

export function buildAppendTransition(input: {
  head: ConversationHead;
  identity: TransitionIdentity;
  entries: readonly AppendEntryDraft[];
  kind?: Exclude<ConversationTransitionKind, "selection_changed">;
  foregroundRunId?: string | null;
}): ConversationTransition {
  if (input.entries.length === 0) {
    throw new Error("An append transition requires at least one entry.");
  }
  if (input.entries.length > 64) {
    throw new Error("An append transition exceeds the bounded entry limit.");
  }
  const transitionId =
    input.identity.transitionId ?? `transition_${randomUUID()}`;
  let parentEntryId = input.head.activeEntryId;
  const entries = input.entries.map((draft, ordinal) => {
    const entry: CanonicalConversationEntry = {
      schemaVersion: 1,
      entryId: draft.entryId ?? `entry_${randomUUID()}`,
      conversationId: input.head.conversationId,
      transitionId,
      ordinal,
      parentEntryId,
      kind: draft.kind,
      ...(draft.inlineContent === undefined
        ? {}
        : { inlineContent: draft.inlineContent }),
      artifacts: draft.artifacts ? [...draft.artifacts] : [],
      ...(draft.runId ? { runId: draft.runId } : {}),
      ...(draft.toolCallId ? { toolCallId: draft.toolCallId } : {}),
      ...(draft.interactionId ? { interactionId: draft.interactionId } : {}),
      provenance: draft.provenance ?? {},
    };
    parentEntryId = entry.entryId;
    return entry;
  });
  const revision = input.head.revision + 1;
  return {
    schemaVersion: 1,
    transitionId,
    conversationId: input.head.conversationId,
    revision,
    kind: input.kind ?? "entries_appended",
    commandId: input.identity.commandId,
    inputFingerprint: input.identity.inputFingerprint,
    actor: input.identity.actor,
    cause: input.identity.cause,
    committedAt: input.identity.committedAt,
    entries,
    evidenceReferences: [],
    resultingHead: {
      ...input.head,
      revision,
      activeEntryId: entries.at(-1)!.entryId,
      foregroundRunId:
        input.foregroundRunId === undefined
          ? input.head.foregroundRunId
          : input.foregroundRunId,
    },
  };
}

export function buildSelectionTransition(input: {
  head: ConversationHead;
  targetEntryId: string | null;
  identity: TransitionIdentity;
}): ConversationTransition | undefined {
  if (input.targetEntryId === input.head.activeEntryId) return undefined;
  const revision = input.head.revision + 1;
  return {
    schemaVersion: 1,
    transitionId: input.identity.transitionId ?? `transition_${randomUUID()}`,
    conversationId: input.head.conversationId,
    revision,
    kind: "selection_changed",
    commandId: input.identity.commandId,
    inputFingerprint: input.identity.inputFingerprint,
    actor: input.identity.actor,
    cause: input.identity.cause,
    committedAt: input.identity.committedAt,
    entries: [],
    evidenceReferences: [],
    resultingHead: {
      ...input.head,
      revision,
      activeEntryId: input.targetEntryId,
      selectionEpoch: input.head.selectionEpoch + 1,
      foregroundRunId: null,
    },
  };
}

export function buildControlTransition(input: {
  head: ConversationHead;
  kind: Exclude<
    ConversationTransitionKind,
    "entries_appended" | "selection_changed" | "history_imported"
  >;
  identity: TransitionIdentity;
  evidenceReferences?: readonly string[];
}): ConversationTransition {
  const revision = input.head.revision + 1;
  return {
    schemaVersion: 1,
    transitionId: input.identity.transitionId ?? `transition_${randomUUID()}`,
    conversationId: input.head.conversationId,
    revision,
    kind: input.kind,
    commandId: input.identity.commandId,
    inputFingerprint: input.identity.inputFingerprint,
    actor: input.identity.actor,
    cause: input.identity.cause,
    committedAt: input.identity.committedAt,
    entries: [],
    evidenceReferences: [...(input.evidenceReferences ?? [])],
    resultingHead: { ...input.head, revision },
  };
}
