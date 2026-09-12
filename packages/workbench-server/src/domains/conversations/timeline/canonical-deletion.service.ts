import type { MutationOutcome } from "@nervekit/contracts/conversations";
import {
  deletionIntentSchema,
  type DeletionIntent,
} from "@nervekit/contracts/storage";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { CanonicalTimelineIdentityService } from "./canonical-timeline-identity.service.js";
import { conversationCommandFingerprint } from "./command-fingerprint.js";
import { ConversationTransitionService } from "./conversation-transition.service.js";
import { buildControlTransition } from "./transition-builders.js";

export type CanonicalDeletionResult =
  | { kind: "committed" | "receipt_replay"; intent: DeletionIntent }
  | { kind: "rejected"; outcome: MutationOutcome };

/** Establishes the deletion fence before cleanup or external erasure begins. */
export class CanonicalDeletionService {
  private readonly identity: CanonicalTimelineIdentityService;
  private readonly transitions: ConversationTransitionService;

  constructor(
    private readonly store: CanonicalStore,
    identity?: CanonicalTimelineIdentityService,
  ) {
    this.identity = identity ?? new CanonicalTimelineIdentityService(store);
    this.transitions = new ConversationTransitionService(store);
  }

  async fence(input: {
    conversationId: string;
    commandId: string;
    uncertaintyAcknowledged: boolean;
    now: string;
  }): Promise<CanonicalDeletionResult> {
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
    const run = head.foregroundRunId
      ? await this.store.readTimelineRunControl(
          input.conversationId,
          head.foregroundRunId,
        )
      : undefined;
    if (head.foregroundRunId && !run) {
      return {
        kind: "rejected",
        outcome: { kind: "superseded", reason: "foreground_control_missing" },
      };
    }
    const fingerprint = conversationCommandFingerprint({
      operation: "fence_conversation_deletion",
      conversationId: input.conversationId,
      uncertaintyAcknowledged: input.uncertaintyAcknowledged,
    });
    const transition = buildControlTransition({
      head,
      kind: "run_changed",
      identity: {
        commandId: input.commandId,
        inputFingerprint: fingerprint,
        actor: { kind: "user" },
        cause: { kind: "delete_requested" },
        committedAt: input.now,
      },
      foregroundRunId: null,
    });
    const intent: DeletionIntent = {
      schemaVersion: 1,
      conversationId: input.conversationId,
      commandId: input.commandId,
      fenceRevision: transition.revision,
      phase: "fenced",
      uncertaintyAcknowledged: input.uncertaintyAcknowledged,
      createdAt: input.now,
      updatedAt: input.now,
    };
    const nextRun = run
      ? {
          ...run,
          state: "deletion_fenced" as const,
          foregroundOwned: false,
          waitGroupId: null,
          providerPhaseId: null,
          revision: run.revision + 1,
        }
      : undefined;
    const outcome = await this.transitions.commit({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: "fence_conversation_deletion",
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
      ...(run
        ? {
            expectedRunFences: [
              {
                conversationId: input.conversationId,
                runId: run.runId,
                generation: run.generation,
                revision: run.revision,
                selectionEpoch: run.boundSelectionEpoch,
                continuationEntryId: run.continuationEntryId,
                requireForegroundOwnership: true,
              },
            ],
            runControls: [nextRun!],
          }
        : {}),
      transitions: [transition],
      deletionIntents: [intent],
      outcome: intent,
      publicationIntents: [],
      now: input.now,
    });
    if (outcome.kind === "committed") return { kind: "committed", intent };
    if (outcome.kind === "receipt_replay") {
      return {
        kind: "receipt_replay",
        intent: deletionIntentSchema.parse(outcome.value),
      };
    }
    return { kind: "rejected", outcome };
  }
}
