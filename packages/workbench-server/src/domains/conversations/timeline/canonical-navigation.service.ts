import {
  conversationHeadSchema,
  type ConversationHead,
  type MutationOutcome,
} from "@nervekit/contracts/conversations";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { CanonicalTimelineIdentityService } from "./canonical-timeline-identity.service.js";
import { conversationCommandFingerprint } from "./command-fingerprint.js";
import { ConversationTransitionService } from "./conversation-transition.service.js";
import { buildSelectionTransition } from "./transition-builders.js";

export type CanonicalNavigationResult =
  | {
      kind: "committed" | "receipt_replay";
      head: ConversationHead;
      changed: boolean;
    }
  | { kind: "rejected"; outcome: MutationOutcome };

/** Changes canonical selection and permanently fences foreground ownership. */
export class CanonicalNavigationService {
  private readonly identity: CanonicalTimelineIdentityService;
  private readonly transitions: ConversationTransitionService;

  constructor(
    private readonly store: CanonicalStore,
    identity?: CanonicalTimelineIdentityService,
  ) {
    this.identity = identity ?? new CanonicalTimelineIdentityService(store);
    this.transitions = new ConversationTransitionService(store);
  }

  async select(input: {
    conversationId: string;
    targetEntryId: string | null;
    commandId: string;
    now: string;
    actor: Record<string, unknown>;
    cause: Record<string, unknown>;
  }): Promise<CanonicalNavigationResult> {
    const [identity, head] = await Promise.all([
      this.identity.resolve(),
      this.store.readTimelineConversationHead(input.conversationId),
    ]);
    if (!head) {
      return {
        kind: "rejected",
        outcome: { kind: "deleted_owner", ownerId: input.conversationId },
      };
    }
    const fingerprint = conversationCommandFingerprint({
      operation: "select_conversation_entry",
      conversationId: input.conversationId,
      targetEntryId: input.targetEntryId,
    });
    const transition = buildSelectionTransition({
      head,
      targetEntryId: input.targetEntryId,
      identity: {
        commandId: input.commandId,
        inputFingerprint: fingerprint,
        actor: input.actor,
        cause: input.cause,
        committedAt: input.now,
      },
    });
    const activeRun = head.foregroundRunId
      ? await this.store.readTimelineRunControl(
          input.conversationId,
          head.foregroundRunId,
        )
      : undefined;
    if (head.foregroundRunId && !activeRun) {
      return {
        kind: "rejected",
        outcome: {
          kind: "superseded",
          reason: "foreground_control_missing",
        },
      };
    }
    const resultingHead = transition?.resultingHead ?? head;
    const nextRun =
      transition && activeRun
        ? {
            ...activeRun,
            state: "superseded" as const,
            foregroundOwned: false,
            waitGroupId: null,
            providerPhaseId: null,
            revision: activeRun.revision + 1,
          }
        : undefined;
    const outcome = await this.transitions.commit({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: "select_conversation_entry",
      ownerKind: "conversation",
      ownerId: input.conversationId,
      commandId: input.commandId,
      fingerprintVersion: 1,
      fingerprint,
      expectedHeads: [
        {
          conversationId: input.conversationId,
          revision: head.revision,
          selectionEpoch: head.selectionEpoch,
        },
      ],
      ...(activeRun
        ? {
            expectedRunFences: [
              {
                conversationId: input.conversationId,
                runId: activeRun.runId,
                generation: activeRun.generation,
                revision: activeRun.revision,
                selectionEpoch: activeRun.boundSelectionEpoch,
                continuationEntryId: activeRun.continuationEntryId,
                requireForegroundOwnership: true,
              },
            ],
          }
        : {}),
      transitions: transition ? [transition] : [],
      runControls: nextRun ? [nextRun] : [],
      outcome: { head: resultingHead, changed: Boolean(transition) },
      publicationIntents: [],
      now: input.now,
    });
    if (outcome.kind === "committed") {
      return {
        kind: "committed",
        head: resultingHead,
        changed: Boolean(transition),
      };
    }
    if (outcome.kind === "receipt_replay") {
      const value = outcome.value as { head?: unknown; changed?: unknown };
      return {
        kind: "receipt_replay",
        head: conversationHeadSchema.parse(value.head),
        changed: value.changed === true,
      };
    }
    return { kind: "rejected", outcome };
  }
}
