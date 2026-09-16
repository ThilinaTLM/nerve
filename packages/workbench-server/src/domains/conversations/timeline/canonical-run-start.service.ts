import { createHash, randomUUID } from "node:crypto";
import type { QueuedPromptRecord } from "@nervekit/contracts/agents";
import type { MutationOutcome } from "@nervekit/contracts/conversations";
import {
  runControlSchema,
  type CanonicalLifecycleWork,
  type ProviderPhase,
  type RunControl,
} from "@nervekit/contracts/runs";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { conversationCommandFingerprint } from "./command-fingerprint.js";
import { CanonicalTimelineIdentityService } from "./canonical-timeline-identity.service.js";
import { ConversationTransitionService } from "./conversation-transition.service.js";
import { buildAppendTransition } from "./transition-builders.js";

export interface CanonicalRunStartInput {
  conversationId: string;
  runId: string;
  agentId: string;
  projectId?: string;
  prompt: string;
  images?: readonly unknown[];
  providerIdentity: Record<string, unknown>;
  providerCapability:
    | "stateless_generation"
    | "contractually_replay_safe"
    | "non_repeatable_or_unknown";
  commandId?: string;
  queuedPrompt?: { record: QueuedPromptRecord; expectedRevision: number };
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
    const identity = await this.identity.resolve();
    const [current, admission] = await Promise.all([
      this.store.readTimelineConversationHead(input.conversationId),
      this.store.readTimelineRuntimeAdmission(),
    ]);
    if (!admission || admission.dispatchState !== "admitted") {
      return {
        kind: "rejected",
        outcome: {
          kind: "superseded",
          reason: "runtime_dispatch_not_admitted",
        },
      };
    }
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
      providerIdentity: input.providerIdentity,
      providerCapability: input.providerCapability,
      queuedPromptId: input.queuedPrompt?.record.id,
    });
    const entryId = `entry_${randomUUID()}`;
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
          entryId,
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
    const phaseId = `provider_phase_${input.runId.slice("run_".length)}_1`;
    const contextRecipeId = `context_recipe_${input.runId.slice("run_".length)}_1`;
    const phase: ProviderPhase = {
      schemaVersion: 1,
      phaseId,
      runId: input.runId,
      runGeneration: 1,
      selectionEpoch: head.selectionEpoch,
      sourceEntryId: entryId,
      contextRecipeId,
      providerIdentity: input.providerIdentity,
      capability: input.providerCapability,
      state: "preparing",
    };
    const work: CanonicalLifecycleWork = {
      schemaVersion: 1,
      workId: `canonical_work_${input.runId.slice("run_".length)}_provider_1`,
      conversationId: input.conversationId,
      runId: input.runId,
      kind: "prepare_provider_request",
      providerPhaseId: phaseId,
      state: "ready",
      inputHash: `sha256:${createHash("sha256")
        .update(fingerprint)
        .digest("hex")}`,
      generation: 0,
      revision: 1,
      notBefore: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    };
    const run: RunControl = {
      schemaVersion: 1,
      conversationId: input.conversationId,
      runId: input.runId,
      generation: 1,
      boundSelectionEpoch: head.selectionEpoch,
      continuationEntryId: transition.resultingHead.activeEntryId,
      checkpointId: null,
      waitGroupId: null,
      providerPhaseId: phaseId,
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
      domainDocuments: input.queuedPrompt
        ? [
            {
              namespace: "canonical_prompt_queue",
              scopeId: input.agentId,
              documentId: input.queuedPrompt.record.id,
              expectedRevision: input.queuedPrompt.expectedRevision,
              payloadVersion: 1,
              data: {
                ...input.queuedPrompt.record,
                status: "delivered",
                runId: input.runId,
                deliveredEntryId: entryId,
                updatedAt: input.now,
              },
            },
          ]
        : [],
      runControls: [run],
      providerPhases: [phase],
      lifecycleWorks: [work],
      outcome: run,
      publicationIntents: input.projectId
        ? [
            {
              intentId: `evt_run_started_${input.runId}`,
              stream: `conv/${input.conversationId}`,
              eventType: "run.started",
              occurredAt: input.now,
              conversationId: input.conversationId,
              data: {
                conversationId: input.conversationId,
                agentId: input.agentId,
                projectId: input.projectId,
                runId: input.runId,
                ...(head.activeEntryId
                  ? { parentEntryId: head.activeEntryId }
                  : {}),
                startedAt: input.now,
              },
            },
          ]
        : [],
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
