import type { MutationOutcome } from "@nervekit/contracts/conversations";
import type {
  PolicyDiagnostic,
  PolicyDocumentObservation,
} from "@nervekit/contracts/permissions";
import {
  runControlSchema,
  type CanonicalExecutionAttempt,
  type CanonicalLifecycleWork,
  type ExactCallAuthorization,
  type ExecutionClaim,
  type LogicalEffect,
  type ProviderPhase,
  type RecoveryAction,
  type RunControl,
  type WaitGroup,
} from "@nervekit/contracts/runs";
import type { TimelineArtifactManifestWrite } from "../../../infrastructure/persistence/canonical-sqlite/timeline-checkpoint-database.js";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { CanonicalTimelineIdentityService } from "./canonical-timeline-identity.service.js";
import { conversationCommandFingerprint } from "./command-fingerprint.js";
import { ConversationTransitionService } from "./conversation-transition.service.js";
import {
  buildAppendTransition,
  buildControlTransition,
  type AppendEntryDraft,
} from "./transition-builders.js";

export interface CanonicalRunMutationIdentity {
  conversationId: string;
  runId: string;
  commandId: string;
  now: string;
  actor: Record<string, unknown>;
  cause: Record<string, unknown>;
  requireRuntimeDispatchAdmission?: true;
}

export type CanonicalRunMutationResult =
  | { kind: "committed" | "receipt_replay"; run: RunControl }
  | { kind: "rejected"; outcome: MutationOutcome };

const terminalStates = new Set<RunControl["state"]>([
  "completed",
  "failed",
  "cancelled",
  "abandoned",
  "superseded",
]);

/** Owns canonical iteration appends and terminal foreground release. */
export class CanonicalRunTimelineService {
  private readonly identity: CanonicalTimelineIdentityService;
  private readonly transitions: ConversationTransitionService;

  constructor(
    private readonly store: CanonicalStore,
    identity?: CanonicalTimelineIdentityService,
  ) {
    this.identity = identity ?? new CanonicalTimelineIdentityService(store);
    this.transitions = new ConversationTransitionService(store);
  }

  append(
    input: CanonicalRunMutationIdentity & {
      entries: readonly AppendEntryDraft[];
      providerPhases?: readonly ProviderPhase[];
      executionAttempts?: readonly CanonicalExecutionAttempt[];
      executionClaims?: readonly ExecutionClaim[];
      lifecycleWorks?: readonly CanonicalLifecycleWork[];
      artifactManifests?: readonly TimelineArtifactManifestWrite[];
      providerPhaseId?: string | null;
      waitGroupId?: string | null;
      runState?: RunControl["state"];
      waitGroups?: readonly WaitGroup[];
      policyObservations?: readonly PolicyDocumentObservation[];
      policyDiagnostics?: readonly PolicyDiagnostic[];
      authorizations?: readonly ExactCallAuthorization[];
      logicalEffects?: readonly LogicalEffect[];
    },
  ): Promise<CanonicalRunMutationResult> {
    return this.mutate(input, input.entries, undefined, {
      providerPhases: input.providerPhases,
      executionAttempts: input.executionAttempts,
      executionClaims: input.executionClaims,
      lifecycleWorks: input.lifecycleWorks,
      artifactManifests: input.artifactManifests,
      providerPhaseId: input.providerPhaseId,
      waitGroupId: input.waitGroupId,
      runState: input.runState,
      waitGroups: input.waitGroups,
      policyObservations: input.policyObservations,
      policyDiagnostics: input.policyDiagnostics,
      authorizations: input.authorizations,
      logicalEffects: input.logicalEffects,
    });
  }

  close(
    input: CanonicalRunMutationIdentity & {
      state: "completed" | "failed" | "cancelled" | "abandoned" | "superseded";
      recoveryReason?: string;
      providerPhases?: readonly ProviderPhase[];
      executionAttempts?: readonly CanonicalExecutionAttempt[];
      executionClaims?: readonly ExecutionClaim[];
      lifecycleWorks?: readonly CanonicalLifecycleWork[];
      recoveryActions?: readonly RecoveryAction[];
      waitGroups?: readonly WaitGroup[];
      authorizations?: readonly ExactCallAuthorization[];
      logicalEffects?: readonly LogicalEffect[];
    },
  ): Promise<CanonicalRunMutationResult> {
    return this.mutate(
      input,
      [],
      {
        state: input.state,
        recoveryReason: input.recoveryReason,
      },
      {
        providerPhases: input.providerPhases,
        executionAttempts: input.executionAttempts,
        executionClaims: input.executionClaims,
        lifecycleWorks: input.lifecycleWorks,
        recoveryActions: input.recoveryActions,
        waitGroups: input.waitGroups,
        authorizations: input.authorizations,
        logicalEffects: input.logicalEffects,
      },
    );
  }

  private async mutate(
    input: CanonicalRunMutationIdentity,
    entries: readonly AppendEntryDraft[],
    terminal:
      | { state: RunControl["state"]; recoveryReason?: string }
      | undefined,
    execution: {
      providerPhases?: readonly ProviderPhase[];
      executionAttempts?: readonly CanonicalExecutionAttempt[];
      executionClaims?: readonly ExecutionClaim[];
      lifecycleWorks?: readonly CanonicalLifecycleWork[];
      artifactManifests?: readonly TimelineArtifactManifestWrite[];
      providerPhaseId?: string | null;
      recoveryActions?: readonly RecoveryAction[];
      waitGroupId?: string | null;
      runState?: RunControl["state"];
      waitGroups?: readonly WaitGroup[];
      policyObservations?: readonly PolicyDocumentObservation[];
      policyDiagnostics?: readonly PolicyDiagnostic[];
      authorizations?: readonly ExactCallAuthorization[];
      logicalEffects?: readonly LogicalEffect[];
    } = {},
  ): Promise<CanonicalRunMutationResult> {
    const [identity, head, run] = await Promise.all([
      this.identity.resolve(),
      this.store.readTimelineConversationHead(input.conversationId),
      this.store.readTimelineRunControl(input.conversationId, input.runId),
    ]);
    const operation = terminal
      ? "close_foreground_run"
      : entries.length > 0
        ? "append_run_entries"
        : "advance_run_execution";
    const fingerprint = conversationCommandFingerprint({
      operation,
      conversationId: input.conversationId,
      runId: input.runId,
      entries,
      terminal,
      execution,
      cause: input.cause,
    });
    if (
      !head ||
      !run ||
      head.foregroundRunId !== input.runId ||
      run.continuationEntryId !== head.activeEntryId ||
      run.boundSelectionEpoch !== head.selectionEpoch ||
      !run.foregroundOwned ||
      terminalStates.has(run.state)
    ) {
      const receipt = await this.store.readTimelineCommandReceipt({
        namespaceId: identity.namespaceId,
        operationKind: operation,
        ownerKind: "conversation",
        ownerId: input.conversationId,
        commandId: input.commandId,
        fingerprint,
      });
      if (receipt?.kind === "receipt_replay") {
        return {
          kind: "receipt_replay",
          run: runControlSchema.parse(receipt.value),
        };
      }
      return {
        kind: "rejected",
        outcome:
          receipt ??
          ({ kind: "superseded", reason: "foreground_fence_changed" } as const),
      };
    }
    const transition = terminal
      ? buildControlTransition({
          head,
          kind: "run_changed",
          identity: {
            commandId: input.commandId,
            inputFingerprint: fingerprint,
            actor: input.actor,
            cause: input.cause,
            committedAt: input.now,
          },
          foregroundRunId: null,
        })
      : entries.length > 0
        ? buildAppendTransition({
            head,
            kind: "entries_appended",
            identity: {
              commandId: input.commandId,
              inputFingerprint: fingerprint,
              actor: input.actor,
              cause: input.cause,
              committedAt: input.now,
            },
            entries: entries.map((entry) => ({ ...entry, runId: input.runId })),
            foregroundRunId: input.runId,
          })
        : undefined;
    const nextRun: RunControl = {
      ...run,
      continuationEntryId:
        transition?.resultingHead.activeEntryId ?? run.continuationEntryId,
      ...(execution.providerPhaseId !== undefined
        ? { providerPhaseId: execution.providerPhaseId }
        : {}),
      ...(execution.waitGroupId !== undefined
        ? { waitGroupId: execution.waitGroupId }
        : {}),
      ...(execution.runState !== undefined
        ? { state: execution.runState }
        : {}),
      ...(terminal
        ? {
            state: terminal.state,
            foregroundOwned: false,
            waitGroupId: null,
            providerPhaseId: null,
            ...(terminal.recoveryReason
              ? { recoveryReason: terminal.recoveryReason }
              : {}),
          }
        : {}),
      revision: run.revision + 1,
    };
    const outcome = await this.transitions.commit({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: operation,
      ownerKind: "conversation",
      ownerId: input.conversationId,
      commandId: input.commandId,
      fingerprintVersion: 1,
      fingerprint,
      ...(input.requireRuntimeDispatchAdmission
        ? { requireRuntimeDispatchAdmission: true as const }
        : {}),
      expectedHeads: [
        {
          conversationId: input.conversationId,
          revision: head.revision,
          selectionEpoch: head.selectionEpoch,
        },
      ],
      expectedRunFences: [
        {
          conversationId: input.conversationId,
          runId: input.runId,
          generation: run.generation,
          revision: run.revision,
          selectionEpoch: run.boundSelectionEpoch,
          continuationEntryId: run.continuationEntryId,
          requireForegroundOwnership: true,
        },
      ],
      transitions: transition ? [transition] : [],
      artifactManifests: execution.artifactManifests
        ? [...execution.artifactManifests]
        : [],
      runControls: [nextRun],
      waitGroups: execution.waitGroups ? [...execution.waitGroups] : [],
      policyObservations: execution.policyObservations
        ? [...execution.policyObservations]
        : [],
      policyDiagnostics: execution.policyDiagnostics
        ? [...execution.policyDiagnostics]
        : [],
      authorizations: execution.authorizations
        ? [...execution.authorizations]
        : [],
      logicalEffects: execution.logicalEffects
        ? [...execution.logicalEffects]
        : [],
      providerPhases: execution.providerPhases
        ? [...execution.providerPhases]
        : [],
      executionAttempts: execution.executionAttempts
        ? [...execution.executionAttempts]
        : [],
      executionClaims: execution.executionClaims
        ? [...execution.executionClaims]
        : [],
      lifecycleWorks: execution.lifecycleWorks
        ? [...execution.lifecycleWorks]
        : [],
      recoveryActions: execution.recoveryActions
        ? [...execution.recoveryActions]
        : [],
      outcome: nextRun,
      publicationIntents: [],
      now: input.now,
    });
    if (outcome.kind === "committed")
      return { kind: "committed", run: nextRun };
    if (outcome.kind === "receipt_replay") {
      return {
        kind: "receipt_replay",
        run: runControlSchema.parse(outcome.value),
      };
    }
    return { kind: "rejected", outcome };
  }
}
