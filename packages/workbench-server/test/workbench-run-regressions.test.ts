import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentRecord,
  PlanReviewRecord,
  RunRecord,
} from "@nervekit/contracts";
import { AutoCompactionRunner } from "../src/domains/agents/run/auto-compaction-runner.js";
import { RuntimeState } from "../src/runtime/runtime-state.js";
import { HumanInputResolutionService } from "../src/domains/human-input/human-input-resolution.service.js";
import { WorkbenchRunQuery } from "../src/domains/runs/workbench-run-query.js";
import {
  agentStatusForRun,
  WorkbenchRunStatusProjector,
} from "../src/domains/runs/workbench-run-status-projector.js";

describe("workbench coordinator behavior regressions", () => {
  it("projects every canonical run status without becoming lifecycle authority", async () => {
    assert.equal(agentStatusForRun("starting"), "running");
    assert.equal(agentStatusForRun("running"), "running");
    assert.equal(agentStatusForRun("retrying"), "running");
    assert.equal(agentStatusForRun("waiting"), "awaiting_user");
    assert.equal(agentStatusForRun("suspended"), "awaiting_user");
    assert.equal(agentStatusForRun("completed"), "idle");
    assert.equal(agentStatusForRun("cancelled"), "aborted");
    assert.equal(agentStatusForRun("failed"), "error");
    assert.equal(agentStatusForRun("interrupted"), "error");
    assert.equal(agentStatusForRun("cancellation_failed"), "error");

    const state = new RuntimeState();
    const agent = agentRecord();
    state.agents.set(agent.id, agent);
    const projected: AgentRecord["status"][] = [];
    const projector = new WorkbenchRunStatusProjector(
      state,
      async (current, status) => {
        projected.push(status);
        state.agents.set(current.id, { ...current, status });
      },
    );
    await projector.committed({ run: runRecord("running", 1) } as never);
    assert.equal(state.agents.get(agent.id)?.status, "running");
    await projector.committed({ run: runRecord("waiting", 2) } as never);
    assert.equal(state.agents.get(agent.id)?.status, "awaiting_user");
    await projector.rebuild([
      {
        run: runRecord("completed", 3),
        transitions: [],
        prompts: [],
        interactions: [],
        checkpoints: [],
        deliveries: [],
      },
    ]);
    assert.deepEqual(projected, ["running", "awaiting_user", "idle"]);
    assert.equal(state.agents.get(agent.id)?.status, "idle");
  });

  it("projects HITL resumes as running and real retries from durable metadata", async () => {
    const runtime = new RuntimeState();
    const legacyResume = {
      run: {
        ...runRecord("retrying", 4),
        attempt: 4,
        failure: undefined,
      },
      transitions: [],
      prompts: [],
      interactions: [],
      checkpoints: [],
      deliveries: [],
    };
    let states = [legacyResume];
    const query = new WorkbenchRunQuery(
      { list: async () => states } as never,
      runtime,
    );

    const resumed = await query.activeForConversation("conv_regression");
    assert.equal(resumed?.status, "running");
    assert.equal(resumed?.retry, undefined);

    const retrying = {
      ...legacyResume,
      run: {
        ...legacyResume.run,
        failure: {
          code: "MODEL_REQUEST_FAILED",
          message: "rate limited",
          retryable: true,
        },
      },
      transitions: [
        {
          events: [
            {
              type: "run.retrying",
              data: {
                attempt: 1,
                maxRetries: 3,
                delayMs: 2_000,
                retryAt: "2026-07-13T00:00:06.000Z",
                errorMessage: "rate limited",
              },
            },
          ],
        },
      ],
    };
    states = [retrying] as never;

    const retry = await query.activeForConversation("conv_regression");
    assert.equal(retry?.status, "retrying");
    assert.deepEqual(retry?.retry, {
      attempt: 1,
      maxRetries: 3,
      delayMs: 2_000,
      retryAt: "2026-07-13T00:00:06.000Z",
      errorMessage: "rate limited",
      failedEntryId: undefined,
    });
  });

  it("terminalizes a new-chat plan source and starts the selected implementation agent", async () => {
    const source = agentRecord();
    const created = {
      ...agentRecord(),
      id: "agent_implementation",
      conversationId: "conv_implementation",
    };
    const review = planReview();
    const createRequests: unknown[] = [];
    const resolutions: Array<Record<string, unknown>> = [];
    const starts: Array<{ agentId: string; text: string }> = [];
    const service = new HumanInputResolutionService({
      plans: {
        listPlanReviews: () => [review],
        acceptPlanReviewInNewChat: async () => ({
          ...review,
          status: "accepted_new_chat",
        }),
        planReviewResult: () => ({ decision: "accept_new_chat" }),
      },
      tools: {
        getToolCall: () => ({
          id: review.toolCallId,
          agentId: source.id,
          conversationId: source.conversationId,
          projectId: source.projectId,
          runId: "run_source",
          toolName: "plan_mode_present",
          status: "waiting_for_user",
          result: { decision: "accept_new_chat" },
        }),
        completeToolCall: async () => ({
          id: review.toolCallId,
          agentId: source.id,
          conversationId: source.conversationId,
          projectId: source.projectId,
          runId: "run_source",
          toolName: "plan_mode_present",
          status: "completed",
          result: { decision: "accept_new_chat" },
        }),
      },
      runs: {
        assertPendingInteractionForToolCall: async () => undefined,
        resolveInteractionForToolCall: async (
          input: Record<string, unknown>,
        ) => {
          resolutions.push(input);
        },
        promptAgent: async (agentId: string, request: { text: string }) => {
          starts.push({ agentId, text: request.text });
        },
      },
      createConversation: async () => ({
        id: created.conversationId,
        projectId: source.projectId,
      }),
      createAgent: async (request: unknown) => {
        createRequests.push(request);
        return created;
      },
      getAgent: (agentId: string) =>
        agentId === created.id ? created : source,
      configureAgent: async () => source,
      setAgentStatus: async () => undefined,
      continueAgent: async () => undefined,
      appendEntry: async (input: Record<string, unknown>) => ({
        ...input,
        id: String(input.id),
      }),
      harnessStorage: {
        appendAgentMessage: async () => ({
          id: "entry_plan_result",
          timestamp: "2026-07-13T00:00:00.000Z",
        }),
      },
    } as never);

    const result = await service.acceptPlanReviewInNewChat(
      review.id,
      undefined,
      {
        implementationModel: {
          provider: "nerve-faux",
          modelId: "faux-selected",
        },
        implementationThinkingLevel: "high",
      },
    );
    assert.equal(result.agent.id, created.id);
    assert.equal(
      (createRequests[0] as { model?: { modelId?: string } }).model?.modelId,
      "faux-selected",
    );
    assert.equal(
      (createRequests[0] as { thinkingLevel?: string }).thinkingLevel,
      "high",
    );
    assert.equal(resolutions[0]?.completeRun, true);
    assert.equal(resolutions[0]?.continueRun, false);
    assert.equal(starts[0]?.agentId, created.id);
    assert.match(starts[0]?.text ?? "", /implement it in this new chat/i);
  });

  it("bounds automatic fresh-run handovers at three and resets only externally", async () => {
    const starts: string[] = [];
    const counts = new Map<string, number>();
    const runner = new AutoCompactionRunner(
      {} as never,
      counts,
      async (_agent, prompt) => {
        starts.push(prompt);
      },
    );
    const agent = agentRecord();
    await runner.continueAfterAutoCompaction(agent);
    await runner.continueAfterAutoCompaction(agent);
    await runner.continueAfterAutoCompaction(agent);
    await runner.continueAfterAutoCompaction(agent);
    assert.equal(starts.length, 3);
    assert.equal(counts.get(agent.conversationId), 3);
    assert.match(starts[0]!, /context checkpoint above/);

    runner.resetContinuationCount(agent.conversationId);
    await runner.continueAfterAutoCompaction(agent);
    assert.equal(starts.length, 4);
  });
});

function agentRecord(): AgentRecord {
  return {
    id: "agent_regression",
    conversationId: "conv_regression",
    projectId: "proj_regression",
    projectDir: "/tmp/project",
    workerId: "worker_regression",
    status: "idle",
    mode: "coding",
    permissionLevel: "supervised",
    approvalPolicy: {
      autoApproveReadOnly: true,
      allowReadOnlyWithoutPrompt: true,
    },
    workspaceScope: "project",
    model: { provider: "nerve-faux", modelId: "faux-fast" },
    thinkingLevel: "off",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  } as AgentRecord;
}

function planReview(): PlanReviewRecord {
  return {
    id: "plan_review_regression",
    toolCallId: "tool_plan_regression",
    agentId: "agent_regression",
    conversationId: "conv_regression",
    projectId: "proj_regression",
    slug: "regression-plan",
    planPath: "/tmp/regression-plan.md",
    status: "pending",
    requestedAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
}

function runRecord(status: RunRecord["status"], revision: number): RunRecord {
  return {
    stateEpoch: 1,
    conversationId: "conv_regression",
    agentId: "agent_regression",
    projectId: "proj_regression",
    runId: `run_${revision}`,
    scopeId: "conv_regression:agent_regression",
    revision,
    status,
    recoverability: status === "completed" ? "not_needed" : "retryable",
    executionId: `exec_${revision}`,
    attempt: 1,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: `2026-07-13T00:00:0${revision}.000Z`,
    cancellationEvidence: [],
  } as RunRecord;
}
