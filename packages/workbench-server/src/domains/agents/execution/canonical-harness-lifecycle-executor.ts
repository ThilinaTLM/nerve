import type { AgentRecord } from "@nervekit/contracts/agents";
import type { AgentMessage, AgentTool } from "@nervekit/harness/agent";
import type { CanonicalToolProposalInput } from "../../conversations/timeline/canonical-tool-batch.js";
import { RUN_STATE_EPOCH, type RunRecord } from "@nervekit/contracts/runs";
import type { CanonicalLifecycleWork } from "@nervekit/contracts/runs";
import type { ToolName } from "@nervekit/contracts/tools";
import type { CanonicalProviderInvocationService } from "../../conversations/timeline/canonical-provider-invocation.service.js";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { CanonicalProviderSettlementService } from "../../conversations/timeline/canonical-provider-settlement.service.js";
import type { WorkbenchAgentMechanics } from "./workbench-agent-mechanics.js";
import type { CanonicalRunExecutionBoundary } from "./canonical-run-execution-boundary.js";

/** Runs one provider obligation with canonical durability and disposable harness state. */
export class CanonicalHarnessLifecycleExecutor {
  constructor(
    private readonly deps: {
      mechanics: WorkbenchAgentMechanics;
      boundary: CanonicalRunExecutionBoundary;
      providerInvocation: CanonicalProviderInvocationService;
      providerSettlement: CanonicalProviderSettlementService;
      store: CanonicalStore;
    },
  ) {}

  async execute(input: {
    agent: AgentRecord;
    providerWork: CanonicalLifecycleWork;
    workerId: string;
    conversationCreatedAt: string;
    signal: AbortSignal;
    tools: AgentTool[];
    activeToolNames: readonly ToolName[];
    prepareToolProposals(
      message: AgentMessage,
    ): Promise<readonly CanonicalToolProposalInput[]>;
    now(): string;
  }): Promise<void> {
    if (
      !["prepare_provider_request", "claim_provider_attempt"].includes(
        input.providerWork.kind,
      ) ||
      input.providerWork.state !== "leased" ||
      input.providerWork.leaseOwner !== input.workerId
    ) {
      throw new Error("Canonical provider work is not owned.");
    }
    const resumed = await this.deps.boundary.resume({
      conversationId: input.providerWork.conversationId,
      runId: input.providerWork.runId,
      agentId: input.agent.id,
      conversationCreatedAt: input.conversationCreatedAt,
    });
    if (resumed.kind === "rejected") {
      throw new Error(
        `Canonical run resume rejected: ${resumed.outcome.kind}.`,
      );
    }
    const now = input.now();
    const run: RunRecord = {
      stateEpoch: RUN_STATE_EPOCH,
      conversationId: input.providerWork.conversationId,
      agentId: input.agent.id,
      projectId: input.agent.projectId,
      runId: input.providerWork.runId,
      scopeId: `canonical:${input.providerWork.conversationId}`,
      revision: 1,
      status: "running",
      recoverability: "checkpoint",
      executionId: `exec_${input.providerWork.runId.slice("run_".length)}`,
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      cancellationEvidence: [],
    };
    const runtime = this.deps.mechanics.deps.state.conversationRuntime;
    runtime.startRun({
      runId: run.runId,
      agentId: run.agentId,
      projectId: run.projectId,
      conversationId: run.conversationId,
      startedAt: now,
    });
    const outcome = await this.deps.mechanics.runCoordinatorExecution({
      run,
      command: "continue",
      signal: input.signal,
      installControl: () => undefined,
      canonical: {
        session: resumed.value,
        boundary: this.deps.boundary,
        providerInvocation: this.deps.providerInvocation,
        providerSettlement: this.deps.providerSettlement,
        providerWork: input.providerWork,
        tools: input.tools,
        activeToolNames: input.activeToolNames,
        prepareToolProposals: input.prepareToolProposals,
        workerId: input.workerId,
        retryPolicy: {
          enabled: this.deps.mechanics.deps.storage.settings.retry.enabled,
          maxRetries:
            this.deps.mechanics.deps.storage.settings.retry.maxRetries,
          baseDelayMs:
            this.deps.mechanics.deps.storage.settings.retry.baseDelayMs,
        },
        now: input.now,
      },
    });
    if (outcome.status === "completed" || outcome.status === "suspended") {
      runtime.completeRun(run.runId);
    } else {
      runtime.failRun(run.runId);
    }
    const canonicalRun = await this.deps.store.readTimelineRunControl(
      run.conversationId,
      run.runId,
    );
    if (
      canonicalRun?.state === "waiting" ||
      canonicalRun?.state === "partially_waiting" ||
      (canonicalRun?.providerPhaseId !== null &&
        canonicalRun?.providerPhaseId !== input.providerWork.providerPhaseId)
    ) {
      return;
    }
    await this.deps.boundary.close(resumed.value, {
      state:
        outcome.status === "completed"
          ? "completed"
          : outcome.status === "interrupted"
            ? "cancelled"
            : "failed",
      now: input.now(),
      ...(outcome.status === "failed"
        ? { recoveryReason: outcome.failure.message }
        : outcome.status === "suspended"
          ? { recoveryReason: "canonical_wait_authority_unavailable" }
          : {}),
    });
  }
}
