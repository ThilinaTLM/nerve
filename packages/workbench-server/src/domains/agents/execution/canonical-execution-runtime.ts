import type { AgentRecord } from "@nervekit/contracts/agents";
import type { PolicyDocumentObservation } from "@nervekit/contracts/permissions";
import type { CanonicalLifecycleWork } from "@nervekit/contracts/runs";
import type { ToolName } from "@nervekit/contracts/tools";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { ToolService } from "../../tools/execution/tool-service.js";
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
}

/** Owns production handlers for all directly dispatchable canonical work. */
export class CanonicalExecutionRuntime {
  constructor(
    private readonly deps: {
      store: CanonicalStore;
      live: CanonicalLiveRunExecutor;
      toolWorker: CanonicalToolWorkerService;
      continuation: CanonicalContinuationService;
      mechanics: WorkbenchAgentMechanics;
      tools: ToolService;
      workerId: string;
      getAgentForConversation(conversationId: string): AgentRecord | undefined;
      getConversationCreatedAt(conversationId: string): string;
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
    prepare_continuation: (work) => this.continueWithoutCompaction(work),
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
        }),
    });
  }

  private async continueWithoutCompaction(
    work: CanonicalLifecycleWork,
  ): Promise<void> {
    const result = await this.deps.continuation.commitWithoutCompaction({
      continuationWork: work,
      workerId: this.deps.workerId,
      now: new Date().toISOString(),
      compactionDecisionEvidence: { decision: "not_required" },
    });
    if (result.kind === "rejected") {
      throw new Error(
        `Canonical continuation rejected: ${result.outcome.kind}.`,
      );
    }
  }
}
