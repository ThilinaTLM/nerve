import { randomUUID } from "node:crypto";
import type { MutationOutcome } from "@nervekit/contracts/conversations";
import { runControlSchema, type RunControl } from "@nervekit/contracts/runs";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { conversationCommandFingerprint } from "./command-fingerprint.js";
import { CanonicalTimelineIdentityService } from "./canonical-timeline-identity.service.js";
import { ConversationTransitionService } from "./conversation-transition.service.js";
import { buildAppendTransition } from "./transition-builders.js";

export interface CanonicalRunStartInput {
  conversationId: string;
  runId: string;
  agentId: string;
  prompt: string;
  images?: readonly unknown[];
  commandId?: string;
  now: string;
}

export type CanonicalRunStartResult =
  | { kind: "started" | "receipt_replay"; run: RunControl }
  | { kind: "rejected"; outcome: MutationOutcome };

/** Atomically accepts a user message and assigns foreground continuation. */
export class CanonicalRunStartService {
  private readonly identity: CanonicalTimelineIdentityService;
  private readonly transitions: ConversationTransitionService;

  constructor(
    private readonly store: CanonicalStore,
    identity?: CanonicalTimelineIdentityService,
  ) {
    this.identity = identity ?? new CanonicalTimelineIdentityService(store);
    this.transitions = new ConversationTransitionService(store);
  }

  async start(input: CanonicalRunStartInput): Promise<CanonicalRunStartResult> {
    const [identity, current] = await Promise.all([
      this.identity.resolve(),
      this.store.readTimelineConversationHead(input.conversationId),
    ]);
    const head =
      current ??
      ({
        schemaVersion: 1,
        conversationId: input.conversationId,
        revision: 0,
        activeEntryId: null,
        selectionEpoch: 0,
        foregroundRunId: null,
      } as const);
    if (head.foregroundRunId !== null && head.foregroundRunId !== input.runId) {
      return {
        kind: "rejected",
        outcome: {
          kind: "cas_conflict",
          current: [
            {
              conversationId: input.conversationId,
              revision: head.revision,
            },
          ],
          retry: "reload_and_revalidate",
        },
      };
    }
    const commandId = input.commandId ?? `start-run:${input.runId}`;
    const fingerprint = conversationCommandFingerprint({
      operation: "start_foreground_run",
      conversationId: input.conversationId,
      runId: input.runId,
      agentId: input.agentId,
      prompt: input.prompt,
      images: input.images,
    });
    const transition = buildAppendTransition({
      head,
      identity: {
        commandId,
        inputFingerprint: fingerprint,
        actor: { kind: "user" },
        cause: { kind: "accepted_prompt", runId: input.runId },
        committedAt: input.now,
        transitionId: `transition_${randomUUID()}`,
      },
      entries: [
        {
          entryId: `entry_${randomUUID()}`,
          kind: "user_message",
          inlineContent: {
            text: input.prompt,
            ...(input.images ? { images: input.images } : {}),
          },
          runId: input.runId,
          provenance: { agentId: input.agentId },
        },
      ],
      foregroundRunId: input.runId,
    });
    const run: RunControl = {
      schemaVersion: 1,
      conversationId: input.conversationId,
      runId: input.runId,
      generation: 1,
      boundSelectionEpoch: head.selectionEpoch,
      continuationEntryId: transition.resultingHead.activeEntryId,
      checkpointId: null,
      waitGroupId: null,
      providerPhaseId: null,
      state: "running",
      foregroundOwned: true,
      revision: 1,
    };
    const outcome = await this.transitions.commit({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: "start_foreground_run",
      ownerKind: "conversation",
      ownerId: input.conversationId,
      commandId,
      fingerprintVersion: 1,
      fingerprint,
      expectedHeads: [
        {
          conversationId: input.conversationId,
          revision: head.revision,
          selectionEpoch: head.selectionEpoch,
          ...(!current ? { createIfMissing: true } : {}),
        },
      ],
      transitions: [transition],
      runControls: [run],
      outcome: run,
      publicationIntents: [],
      now: input.now,
    });
    if (outcome.kind === "committed") return { kind: "started", run };
    if (outcome.kind === "receipt_replay") {
      return {
        kind: "receipt_replay",
        run: runControlSchema.parse(outcome.value),
      };
    }
    return { kind: "rejected", outcome };
  }
}
