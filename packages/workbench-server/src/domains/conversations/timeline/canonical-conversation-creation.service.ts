import { randomUUID } from "node:crypto";
import {
  conversationHeadSchema,
  type CanonicalConversationEntry,
  type ConversationHead,
  type MutationOutcome,
} from "@nervekit/contracts/conversations";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { CanonicalTimelineIdentityService } from "./canonical-timeline-identity.service.js";
import { conversationCommandFingerprint } from "./command-fingerprint.js";
import { ConversationTransitionService } from "./conversation-transition.service.js";
import { buildAppendTransition } from "./transition-builders.js";

export type CanonicalConversationCreationResult =
  | { kind: "committed" | "receipt_replay"; head: ConversationHead }
  | { kind: "rejected"; outcome: MutationOutcome };

/** Creates empty conversations or imports one immutable linear baseline. */
export class CanonicalConversationCreationService {
  private readonly identity: CanonicalTimelineIdentityService;
  private readonly transitions: ConversationTransitionService;

  constructor(private readonly store: CanonicalStore) {
    this.identity = new CanonicalTimelineIdentityService(store);
    this.transitions = new ConversationTransitionService(store);
  }

  createEmpty(input: {
    conversationId: string;
    commandId: string;
    now: string;
  }): Promise<CanonicalConversationCreationResult> {
    return this.create(input, []);
  }

  importHistory(input: {
    conversationId: string;
    commandId: string;
    entries: readonly Omit<
      CanonicalConversationEntry,
      | "schemaVersion"
      | "conversationId"
      | "transitionId"
      | "ordinal"
      | "parentEntryId"
    >[];
    now: string;
  }): Promise<CanonicalConversationCreationResult> {
    if (input.entries.length === 0) return this.createEmpty(input);
    return this.create(input, input.entries);
  }

  private async create(
    input: { conversationId: string; commandId: string; now: string },
    entries: readonly Omit<
      CanonicalConversationEntry,
      | "schemaVersion"
      | "conversationId"
      | "transitionId"
      | "ordinal"
      | "parentEntryId"
    >[],
  ): Promise<CanonicalConversationCreationResult> {
    const identity = await this.identity.resolve();
    const emptyHead: ConversationHead = {
      schemaVersion: 1,
      conversationId: input.conversationId,
      revision: 0,
      activeEntryId: null,
      selectionEpoch: 0,
      foregroundRunId: null,
    };
    const fingerprint = conversationCommandFingerprint({
      operation:
        entries.length === 0 ? "create_conversation" : "import_history",
      conversationId: input.conversationId,
      entries,
    });
    const transition = entries.length
      ? buildAppendTransition({
          head: emptyHead,
          identity: {
            commandId: input.commandId,
            inputFingerprint: fingerprint,
            actor: { kind: "system" },
            cause: { kind: "history_import" },
            committedAt: input.now,
            transitionId: `transition_${randomUUID()}`,
          },
          kind: "history_imported",
          entries,
        })
      : undefined;
    const intendedHead = transition?.resultingHead ?? emptyHead;
    const outcome = await this.transitions.commit({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: transition
        ? "import_conversation_history"
        : "create_conversation",
      ownerKind: "conversation",
      ownerId: input.conversationId,
      commandId: input.commandId,
      fingerprintVersion: 1,
      fingerprint,
      expectedHeads: [
        {
          conversationId: input.conversationId,
          revision: 0,
          selectionEpoch: 0,
          createIfMissing: true,
        },
      ],
      transitions: transition ? [transition] : [],
      outcome: intendedHead,
      publicationIntents: [],
      now: input.now,
    });
    if (outcome.kind === "committed")
      return { kind: "committed", head: intendedHead };
    if (outcome.kind === "receipt_replay") {
      return {
        kind: "receipt_replay",
        head: conversationHeadSchema.parse(outcome.value),
      };
    }
    return { kind: "rejected", outcome };
  }
}
