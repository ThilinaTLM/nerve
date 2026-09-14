import type { AgentRecord } from "@nervekit/contracts/agents";
import { RUN_STATE_EPOCH, type RunRecord } from "@nervekit/contracts/runs";
import type { CanonicalLifecycleWork } from "@nervekit/contracts/runs";
import type { RunExecutionSink } from "../../runs/runtime/index.js";
import type { CanonicalProviderInvocationService } from "../../conversations/timeline/canonical-provider-invocation.service.js";
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
    },
  ) {}

  async execute(input: {
    agent: AgentRecord;
    preparationWork: CanonicalLifecycleWork;
    workerId: string;
    conversationCreatedAt: string;
    signal: AbortSignal;
    now(): string;
  }): Promise<void> {
    if (
      input.preparationWork.kind !== "prepare_provider_request" ||
      input.preparationWork.state !== "leased" ||
      input.preparationWork.leaseOwner !== input.workerId
    ) {
      throw new Error("Canonical provider preparation work is not owned.");
    }
    const resumed = await this.deps.boundary.resume({
      conversationId: input.preparationWork.conversationId,
      runId: input.preparationWork.runId,
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
      conversationId: input.preparationWork.conversationId,
      agentId: input.agent.id,
      projectId: input.agent.projectId,
      runId: input.preparationWork.runId,
      scopeId: `canonical:${input.preparationWork.conversationId}`,
      revision: 1,
      status: "running",
      recoverability: "checkpoint",
      executionId: `exec_${input.preparationWork.runId.slice("run_".length)}`,
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      cancellationEvidence: [],
    };
    const outcome = await this.deps.mechanics.runCoordinatorExecution({
      run,
      sink: inertLegacySink,
      command: "continue",
      signal: input.signal,
      installControl: () => undefined,
      checkpointCommand: async () =>
        ({
          runId: run.runId,
          checkpointId: `checkpoint_canonical_${run.runId.slice("run_".length)}`,
          boundary: "after_provider_response",
          continuation: { kind: "provider" },
        }) as never,
      canonical: {
        session: resumed.value,
        boundary: this.deps.boundary,
        providerInvocation: this.deps.providerInvocation,
        providerSettlement: this.deps.providerSettlement,
        preparationWork: input.preparationWork,
        workerId: input.workerId,
        now: input.now,
      },
    });
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

const inertLegacySink: RunExecutionSink = {
  appendEntries: async () => undefined,
  upsertToolCalls: async () => undefined,
  promptDelivered: async () => undefined,
  checkpoint: async () => ({}) as never,
  wait: async () => ({}) as never,
  waitMany: async () => [],
  progress: () => undefined,
};
