import type { AgentRecord } from "@nervekit/contracts/agents";
import type { PolicyDocumentObservation } from "@nervekit/contracts/permissions";
import type { CanonicalLifecycleWork } from "@nervekit/contracts/runs";
import type { ToolName } from "@nervekit/contracts/tools";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { ToolService } from "../../tools/execution/tool-service.js";
import type { CanonicalAutoCompactionService } from "../../conversations/timeline/canonical-auto-compaction.service.js";
import type { CanonicalContinuationService } from "../../conversations/timeline/canonical-continuation.service.js";
import type { CanonicalToolWorkerService } from "../../conversations/timeline/canonical-tool-worker.service.js";
import type { CanonicalLiveRunExecutor } from "./canonical-live-run-executor.js";
import type { WorkbenchAgentMechanics } from "./workbench-agent-mechanics.js";

interface ToolManifest {
  normalizedInput: Record<string, unknown>;
  normalizedInputFingerprint: string;
  policyObservation: PolicyDocumentObservation;
  providerToolCallId: string;
  toolName: ToolName;
  exactApproval?: boolean;
}

/** Owns production handlers for all directly dispatchable canonical work. */
export class CanonicalExecutionRuntime {
  constructor(
    private readonly deps: {
      store: CanonicalStore;
      live: CanonicalLiveRunExecutor;
      toolWorker: CanonicalToolWorkerService;
      continuation: CanonicalContinuationService;
      autoCompaction: CanonicalAutoCompactionService;
      mechanics: WorkbenchAgentMechanics;
      tools: ToolService;
      workerId: string;
      getAgentForConversation(conversationId: string): AgentRecord | undefined;
      getConversationCreatedAt(conversationId: string): string;
      onForegroundClosed?(conversationId: string): Promise<void>;
    },
  ) {}

  readonly handlers: Partial<
    Record<
      CanonicalLifecycleWork["kind"],
      (work: CanonicalLifecycleWork) => Promise<void>
    >
  > = {
    prepare_provider_request: (work) => this.executeProvider(work),
    claim_provider_attempt: (work) => this.executeProvider(work),
    claim_tool_attempt: (work) => this.executeTool(work),
    execute_internal_command: (work) => this.executeInternalCommand(work),
    prepare_continuation: (work) => this.prepareContinuation(work),
  };

  private requireAgent(conversationId: string): AgentRecord {
    const agent = this.deps.getAgentForConversation(conversationId);
    if (!agent)
      throw new Error(
        `Canonical conversation '${conversationId}' has no agent.`,
      );
    return agent;
  }

  private async executeProvider(work: CanonicalLifecycleWork): Promise<void> {
    const agent = this.requireAgent(work.conversationId);
    await this.deps.live.execute({
      agent,
      providerWork: work,
      workerId: this.deps.workerId,
      activeToolNames: await this.deps.mechanics.activeToolNamesFor(agent),
      conversationCreatedAt: this.deps.getConversationCreatedAt(
        work.conversationId,
      ),
      signal: new AbortController().signal,
    });
    const head = await this.deps.store.readTimelineConversationHead(
      work.conversationId,
    );
    if (!head?.foregroundRunId) {
      await this.deps.onForegroundClosed?.(work.conversationId);
    }
  }

  private async executeInternalCommand(
    work: CanonicalLifecycleWork,
  ): Promise<void> {
    await this.deps.toolWorker.executeInternal({
      agent: this.requireAgent(work.conversationId),
      work,
      now: new Date().toISOString(),
    });
  }

  private async executeTool(work: CanonicalLifecycleWork): Promise<void> {
    const agent = this.requireAgent(work.conversationId);
    const manifest = work.inputManifestId
      ? ((await this.deps.store.execution.readArtifactManifest(
          work.inputManifestId,
        )) as ToolManifest | undefined)
      : undefined;
    if (!manifest)
      throw new Error("Canonical tool work has no input manifest.");
    await this.deps.toolWorker.execute({
      agent,
      claimWork: work,
      workerId: this.deps.workerId,
      now: new Date().toISOString(),
      revalidatePolicy: () =>
        this.deps.tools.revalidateCanonicalToolProposal({
          agent,
          toolName: manifest.toolName,
          args: manifest.normalizedInput,
          providerToolCallId: manifest.providerToolCallId,
          normalizedInputFingerprint: manifest.normalizedInputFingerprint,
          completeDocumentDigest:
            manifest.policyObservation.completeDocumentDigest,
          selectedRuleSetDigest:
            manifest.policyObservation.selectedRuleSetDigest,
          exactApproval: manifest.exactApproval,
        }),
    });
  }

  private async prepareContinuation(
    work: CanonicalLifecycleWork,
  ): Promise<void> {
    const manifest = work.inputManifestId
      ? ((await this.deps.store.execution.readArtifactManifest(
          work.inputManifestId,
        )) as
          | {
              providerIdentity: Record<string, unknown>;
              providerCapability:
                | "stateless_generation"
                | "contractually_replay_safe"
                | "non_repeatable_or_unknown";
            }
          | undefined)
      : undefined;
    const head = await this.deps.store.readTimelineConversationHead(
      work.conversationId,
    );
    if (!manifest || !head?.activeEntryId) {
      throw new Error("Canonical continuation evidence is unavailable.");
    }
    const entries =
      [] as import("@nervekit/contracts/conversations").CanonicalConversationEntry[];
    let next: string | undefined = head.activeEntryId;
    while (next) {
      const page = await this.deps.store.readTimelineAncestrySegment(
        work.conversationId,
        next,
        512,
      );
      entries.push(...page.entries);
      next = page.nextAncestorEntryId;
    }
    const contextBytes = entries.reduce(
      (total, entry) =>
        total + JSON.stringify(entry.inlineContent ?? {}).length,
      0,
    );
    const now = new Date().toISOString();
    if (contextBytes >= 120_000) {
      const identity = await this.deps.store.readTimelineStateIdentity();
      if (!identity)
        throw new Error("Canonical timeline identity is unavailable.");
      const result =
        await this.deps.autoCompaction.compactThenPrepareProviderPhase({
          namespaceId: identity.namespaceId,
          executionIncarnationId: identity.executionIncarnationId,
          conversationId: work.conversationId,
          runId: work.runId,
          policyVersion: 1,
          providerAdapterVersion: "canonical-v1",
          providerIdentity: manifest.providerIdentity,
          providerCapability: manifest.providerCapability,
          recipeVersion: 1,
          preparedAt: now,
          continuationWork: work,
          scheduleProviderPreparation: true,
          prepareSummary: async (source) => ({
            summary: [...source]
              .reverse()
              .map((entry) => {
                const content = entry.inlineContent as Record<string, unknown>;
                return typeof content.text === "string" ? content.text : "";
              })
              .filter(Boolean)
              .join("\n\n")
              .slice(-64_000),
            anchorEntryId: null,
          }),
          prepareProviderPhase: async () => undefined,
        });
      if (result.kind === "stale") {
        throw new Error(
          `Canonical compaction rejected: ${result.outcome.kind}.`,
        );
      }
      return;
    }
    const result = await this.deps.continuation.commitWithoutCompaction({
      continuationWork: work,
      workerId: this.deps.workerId,
      now,
      compactionDecisionEvidence: {
        decision: "not_required",
        contextBytes,
        thresholdBytes: 120_000,
      },
    });
    if (result.kind === "rejected") {
      throw new Error(
        `Canonical continuation rejected: ${result.outcome.kind}.`,
      );
    }
  }
}
