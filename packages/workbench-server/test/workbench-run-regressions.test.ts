/* eslint-disable max-lines -- Run regression scenarios share deterministic lifecycle fixtures. */
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

  it("preserves newer persisted agent status during startup rebuild", async () => {
    const state = new RuntimeState();
    const newerAgent = {
      ...agentRecord(),
      status: "idle" as const,
      updatedAt: "2026-07-13T00:00:10.000Z",
    };
    state.agents.set(newerAgent.id, newerAgent);
    const projected: AgentRecord["status"][] = [];
    const projector = new WorkbenchRunStatusProjector(
      state,
      async (current, status) => {
        projected.push(status);
        state.agents.set(current.id, { ...current, status });
      },
    );
    const failedRun = runRecord("failed", 5);
    const hydrated = {
      run: failedRun,
      transitions: [],
      prompts: [],
      interactions: [],
      checkpoints: [],
      deliveries: [],
    };

    await projector.rebuild([hydrated]);
    assert.deepEqual(projected, []);
    assert.equal(state.agents.get(newerAgent.id)?.status, "idle");

    state.agents.set(newerAgent.id, {
      ...newerAgent,
      updatedAt: "2026-07-13T00:00:04.000Z",
    });
    await projector.rebuild([hydrated]);
    assert.deepEqual(projected, ["error"]);
    assert.equal(state.agents.get(newerAgent.id)?.status, "error");
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
      {
        list: async () => states,
        listActive: async () => states,
      } as never,
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

  it("preserves canonical waiting runs and queued prompts in snapshots", async () => {
    const runtime = new RuntimeState();
    const queuedPrompt = {
      id: "promptq_waiting",
      agentId: "agent_regression",
      conversationId: "conv_regression",
      projectId: "proj_regression",
      runId: "run_regression",
      behavior: "steer",
      text: "queued while waiting",
      status: "queued",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    };
    const states = [
      {
        run: runRecord("waiting", 4),
        transitions: [],
        prompts: [queuedPrompt],
        interactions: [],
        checkpoints: [],
        deliveries: [],
      },
    ];
    const query = new WorkbenchRunQuery(
      {
        list: async () => states,
        listActive: async () => states,
      } as never,
      runtime,
    );

    const waiting = await query.activeForConversation("conv_regression");
    assert.equal(waiting?.status, "waiting");
    assert.equal(waiting?.retry, undefined);
    assert.deepEqual(waiting?.queuedPrompts, [queuedPrompt]);
  });

  it("projects only checkpoint-backed interruptions as continuable", async () => {
    const runtime = new RuntimeState();
    let states = [
      {
        run: {
          ...runRecord("interrupted", 4),
          recoverability: "checkpoint" as const,
          failure: {
            code: "RUN_INTERRUPTED",
            message: "Host restarted during active execution",
            retryable: true,
          },
        },
        transitions: [],
        prompts: [],
        interactions: [],
        checkpoints: [],
        deliveries: [],
      },
    ];
    const query = new WorkbenchRunQuery(
      {
        list: async () => states,
        listActive: async () => states,
      } as never,
      runtime,
    );

    const interrupted = await query.activeForConversation("conv_regression");
    assert.equal(interrupted?.status, "interrupted");
    assert.deepEqual(interrupted?.recovery, {
      errorMessage: "Host restarted during active execution",
      continuable: true,
    });

    states = [
      {
        ...states[0],
        run: {
          ...states[0]!.run,
          status: "failed" as const,
          recoverability: "none" as const,
          failure: {
            code: "INVALID_CHECKPOINT",
            message: "No valid checkpoint",
            retryable: true,
          },
        },
      },
    ];
    assert.equal(
      await query.activeForConversation("conv_regression"),
      undefined,
    );
  });

  it("continues a valid pending plan interaction without starting a replacement run", async () => {
    const fixture = acceptanceFixture("pending");

    const accepted = await fixture.service.acceptPlanReview(fixture.review.id);

    assert.equal(accepted.status, "accepted");
    assert.equal(fixture.resolutions.length, 1);
    assert.equal(fixture.resolutions[0]?.continueRun, true);
    assert.equal(fixture.starts.length, 0);
  });

  it("accepts a plan after source cancellation without continuing the cancelled run", async () => {
    const fixture = acceptanceFixture("terminal");

    await fixture.service.acceptPlanReview(fixture.review.id);

    assert.equal(fixture.resolutions.length, 0);
    assert.equal(fixture.resumedToolCalls.length, 1);
    assert.equal(fixture.currentToolCall.status, "completed");
    assert.equal(fixture.starts.length, 1);
  });

  it("starts accepted terminal-orphan plans in the same conversation", async () => {
    const fixture = acceptanceFixture("terminal");

    const accepted = await fixture.service.acceptPlanReview(fixture.review.id);

    assert.equal(accepted.status, "accepted");
    assert.equal(fixture.resolutions.length, 0);
    assert.equal(fixture.resumedToolCalls.length, 1);
    assert.equal(fixture.completedToolCalls.length, 1);
    assert.equal(fixture.appendedEntries.length, 1);
    assert.equal(fixture.starts.length, 1);
    assert.equal(fixture.starts[0]?.agentId, fixture.review.agentId);
    assert.match(fixture.starts[0]?.text ?? "", /source of truth/i);
  });

  it("falls back to a same-conversation run when acceptance races terminal state", async () => {
    const fixture = acceptanceFixture("terminal_race");

    const accepted = await fixture.service.acceptPlanReview(fixture.review.id);

    assert.equal(accepted.status, "accepted");
    assert.equal(fixture.resolutions.length, 1);
    assert.equal(fixture.resumedToolCalls.length, 1);
    assert.equal(fixture.completedToolCalls.length, 1);
    assert.equal(fixture.appendedEntries.length, 2);
    assert.equal(fixture.starts.length, 1);
  });

  it("recovers an accepted review with a pending source interaction", async () => {
    const fixture = acceptanceFixture("pending", "accepted");

    await fixture.service.recoverAcceptedPlanReviews();

    assert.equal(fixture.resolutions.length, 1);
    assert.equal(fixture.resolutions[0]?.continueRun, true);
    assert.equal(fixture.resumedToolCalls.length, 1);
    assert.equal(fixture.completedToolCalls.length, 1);
    assert.equal(fixture.appendedEntries.length, 2);
    assert.equal(fixture.starts.length, 0);
  });

  it("recovers when an accepted review source becomes terminal during continuation", async () => {
    const fixture = acceptanceFixture("terminal_race", "accepted");

    await fixture.service.recoverAcceptedPlanReviews();

    assert.equal(fixture.resolutions.length, 1);
    assert.equal(fixture.currentToolCall.status, "completed");
    assert.equal(fixture.appendedEntries.length, 2);
    assert.equal(fixture.starts.length, 1);
  });

  it("recovers an accepted review left waiting after source cancellation exactly once", async () => {
    const fixture = acceptanceFixture("terminal", "accepted");

    await fixture.service.recoverAcceptedPlanReviews();

    assert.equal(fixture.currentToolCall.status, "completed");
    assert.equal(fixture.resumedToolCalls.length, 1);
    assert.equal(fixture.completedToolCalls.length, 1);
    assert.equal(fixture.appendedEntries.length, 1);
    assert.equal(fixture.starts.length, 1);

    await fixture.service.recoverAcceptedPlanReviews();

    assert.equal(fixture.resumedToolCalls.length, 1);
    assert.equal(fixture.completedToolCalls.length, 1);
    assert.equal(fixture.appendedEntries.length, 1);
    assert.equal(fixture.starts.length, 1);
  });

  it("accepts a terminal-orphan plan into a new chat", async () => {
    const fixture = acceptanceFixture("terminal");

    const accepted = await fixture.service.acceptPlanReviewInNewChat(
      fixture.review.id,
    );

    assert.equal(accepted.planReview.status, "accepted_in_new_chat");
    assert.equal(fixture.resolutions.length, 0);
    assert.equal(fixture.resumedToolCalls.length, 1);
    assert.equal(fixture.completedToolCalls.length, 1);
    assert.equal(fixture.appendedEntries.length, 1);
    assert.equal(fixture.starts[0]?.agentId, fixture.createdAgent.id);
    assert.match(
      fixture.starts[0]?.text ?? "",
      /implement it in this new chat/i,
    );
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
          status: "accepted_in_new_chat",
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
        resumeToolCall: async () => ({
          id: review.toolCallId,
          agentId: source.id,
          conversationId: source.conversationId,
          projectId: source.projectId,
          runId: "run_source",
          toolName: "plan_mode_present",
          status: "running",
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
        interactionResolutionStateForToolCall: async () => "pending",
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

  it("rejects a pending plan by terminally resolving without continuation", async () => {
    const fixture = rejectionFixture("pending");

    const rejected = await fixture.service.rejectPlanReview(
      fixture.review.id,
      "Needs more work.",
    );

    assert.equal(rejected.status, "changes_requested");
    assert.equal(fixture.resolutions.length, 1);
    assert.equal(fixture.resumedToolCalls.length, 1);
    assert.equal(fixture.resolutions[0]?.continueRun, false);
    assert.equal(fixture.resolutions[0]?.completeRun, true);
    assert.equal(fixture.completedToolCalls.length, 1);
    assert.equal(fixture.appendedEntries.length, 1);
    assert.equal(fixture.source.status, "idle");
    assert.deepEqual(fixture.statusUpdates, []);
  });

  it("settles a detached rejected plan to idle", async () => {
    const fixture = rejectionFixture("detached");

    const rejected = await fixture.service.rejectPlanReview(fixture.review.id);

    assert.equal(rejected.status, "changes_requested");
    assert.equal(fixture.resolutions.length, 0);
    assert.equal(fixture.resumedToolCalls.length, 1);
    assert.equal(fixture.completedToolCalls.length, 1);
    assert.equal(fixture.appendedEntries.length, 0);
    assert.equal(fixture.source.status, "idle");
    assert.deepEqual(fixture.statusUpdates, ["idle"]);
  });

  it("reconciles when the source run becomes terminal during rejection", async () => {
    const fixture = rejectionFixture("terminal_race");

    const rejected = await fixture.service.rejectPlanReview(fixture.review.id);

    assert.equal(rejected.status, "changes_requested");
    assert.equal(fixture.resolutions.length, 1);
    assert.equal(fixture.resumedToolCalls.length, 1);
    assert.equal(fixture.completedToolCalls.length, 1);
    assert.equal(fixture.appendedEntries.length, 1);
    assert.equal(fixture.source.status, "idle");
    assert.deepEqual(fixture.statusUpdates, ["idle"]);
  });

  it("reconciles an orphaned plan review whose source run is terminal", async () => {
    const fixture = rejectionFixture("terminal");

    const rejected = await fixture.service.rejectPlanReview(
      fixture.review.id,
      "Stop here.",
    );

    assert.equal(rejected.status, "changes_requested");
    assert.equal(fixture.resolutions.length, 0);
    assert.equal(fixture.resumedToolCalls.length, 1);
    assert.equal(fixture.completedToolCalls.length, 1);
    assert.equal(fixture.appendedEntries.length, 1);
    assert.equal(fixture.source.status, "idle");
    assert.deepEqual(fixture.statusUpdates, ["idle"]);
  });

  it("bounds automatic same-run continuations at three and resets on run finish", () => {
    const runner = new AutoCompactionRunner({} as never);
    const runId = "run_compaction_guard";
    const continuations = [
      runner.takeContinuation(runId),
      runner.takeContinuation(runId),
      runner.takeContinuation(runId),
      runner.takeContinuation(runId),
    ];
    assert.equal(continuations.filter(Boolean).length, 3);
    assert.equal(continuations[3], undefined);
    assert.match(continuations[0]!, /Work Remaining/);

    runner.finishRun(runId);
    assert.ok(runner.takeContinuation(runId));
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

function acceptanceFixture(
  sourceState: "pending" | "terminal" | "terminal_race",
  reviewStatus: PlanReviewRecord["status"] = "pending",
) {
  const source = { ...agentRecord(), mode: "planning" as const };
  const review = { ...planReview(), status: reviewStatus };
  const createdAgent = {
    ...agentRecord(),
    id: "agent_implementation",
    conversationId: "conv_implementation",
    mode: "coding" as const,
  };
  const resolutions: Array<Record<string, unknown>> = [];
  const starts: Array<{ agentId: string; text: string }> = [];
  const resumedToolCalls: unknown[] = [];
  const completedToolCalls: unknown[] = [];
  const appendedEntries: Array<Record<string, unknown>> = [];
  let currentReview = review;
  let currentToolCall = {
    id: review.toolCallId,
    agentId: source.id,
    conversationId: source.conversationId,
    projectId: source.projectId,
    runId: "run_source",
    turnId: "turn_source",
    providerToolCallId: "provider_plan",
    toolName: "plan_mode_present",
    status: "waiting_for_user",
  };
  let stateChecks = 0;
  const planResult = () => ({
    review: currentReview,
    outcome: currentReview.status,
    mode: currentReview.status === "accepted" ? "coding" : "planning",
    contentBlocks: [{ type: "text", text: "Plan accepted." }],
  });
  const service = new HumanInputResolutionService({
    plans: {
      listPlanReviews: () => [currentReview],
      acceptPlanReview: async () => {
        currentReview = { ...currentReview, status: "accepted" };
        return currentReview;
      },
      acceptPlanReviewInNewChat: async () => {
        currentReview = { ...currentReview, status: "accepted_in_new_chat" };
        return currentReview;
      },
      planReviewResult: planResult,
    },
    tools: {
      getToolCall: () => currentToolCall,
      resumeToolCall: async () => {
        assert.equal(currentToolCall.status, "waiting_for_user");
        currentToolCall = { ...currentToolCall, status: "running" };
        resumedToolCalls.push(currentToolCall);
        return currentToolCall;
      },
      completeToolCall: async () => {
        assert.equal(currentToolCall.status, "running");
        currentToolCall = {
          ...currentToolCall,
          status: "completed",
          result: planResult(),
        };
        completedToolCalls.push(currentToolCall);
        return currentToolCall;
      },
    },
    runs: {
      interactionResolutionStateForToolCall: async () => {
        stateChecks += 1;
        if (sourceState === "terminal_race") {
          return stateChecks === 1 ? "pending" : "terminal";
        }
        return sourceState;
      },
      resolveInteractionForToolCall: async (input: Record<string, unknown>) => {
        resolutions.push(input);
        if (sourceState === "terminal_race") {
          throw new Error("run became terminal");
        }
      },
      promptAgent: async (agentId: string, request: { text: string }) => {
        starts.push({ agentId, text: request.text });
      },
    },
    getAgent: (agentId: string) =>
      agentId === createdAgent.id ? createdAgent : source,
    configureAgent: async () => source,
    setAgentStatus: async () => undefined,
    continueAgent: async () => undefined,
    createConversation: async () => ({
      id: createdAgent.conversationId,
      projectId: source.projectId,
    }),
    createAgent: async () => createdAgent,
    appendEntry: async (input: Record<string, unknown>) => {
      appendedEntries.push(input);
      return { ...input, id: String(input.id) };
    },
    getConversationEntries: () => appendedEntries as never,
    harnessStorage: {
      appendAgentMessage: async () => ({
        id: "entry_plan_accepted",
        timestamp: "2026-07-13T00:00:01.000Z",
      }),
    },
  } as never);
  return {
    service,
    review,
    get currentToolCall() {
      return currentToolCall;
    },
    createdAgent,
    resolutions,
    starts,
    resumedToolCalls,
    completedToolCalls,
    appendedEntries,
  };
}

function rejectionFixture(
  sourceState: "detached" | "pending" | "terminal" | "terminal_race",
) {
  let source: AgentRecord = {
    ...agentRecord(),
    mode: "planning",
    status: sourceState === "pending" ? "awaiting_user" : "error",
  };
  const review = planReview();
  const resolutions: Array<Record<string, unknown>> = [];
  const resumedToolCalls: unknown[] = [];
  const completedToolCalls: unknown[] = [];
  const appendedEntries: Array<Record<string, unknown>> = [];
  const statusUpdates: AgentRecord["status"][] = [];
  const pendingToolCall = {
    id: review.toolCallId,
    agentId: source.id,
    conversationId: source.conversationId,
    projectId: source.projectId,
    runId: sourceState === "detached" ? undefined : "run_source",
    turnId: "turn_source",
    providerToolCallId: "provider_plan",
    toolName: "plan_mode_present",
    status: "waiting_for_user",
  };
  let currentToolCall = pendingToolCall;
  let stateChecks = 0;
  const planResult = {
    review: { ...review, status: "changes_requested" },
    outcome: "changes_requested",
    mode: "planning",
    contentBlocks: [{ type: "text", text: "Plan rejected." }],
  };
  const service = new HumanInputResolutionService({
    plans: {
      listPlanReviews: () => [review],
      rejectPlanReview: async (_id: string, feedback?: string) => ({
        ...review,
        status: "changes_requested",
        feedback,
      }),
      planReviewResult: () => planResult,
    },
    tools: {
      getToolCall: () => currentToolCall,
      resumeToolCall: async () => {
        assert.equal(currentToolCall.status, "waiting_for_user");
        currentToolCall = { ...currentToolCall, status: "running" };
        resumedToolCalls.push(currentToolCall);
        return currentToolCall;
      },
      completeToolCall: async () => {
        assert.equal(currentToolCall.status, "running");
        currentToolCall = {
          ...currentToolCall,
          status: "completed",
          result: planResult,
        };
        completedToolCalls.push(currentToolCall);
        return currentToolCall;
      },
    },
    runs: {
      interactionResolutionStateForToolCall: async () => {
        stateChecks += 1;
        if (sourceState === "terminal_race") {
          return stateChecks === 1 ? "pending" : "terminal";
        }
        return sourceState;
      },
      resolveInteractionForToolCall: async (input: Record<string, unknown>) => {
        resolutions.push(input);
        if (sourceState === "terminal_race") {
          throw new Error("run became terminal");
        }
        source = { ...source, status: "idle" };
      },
    },
    getAgent: () => source,
    configureAgent: async () => source,
    setAgentStatus: async (
      agent: AgentRecord,
      status: AgentRecord["status"],
    ) => {
      statusUpdates.push(status);
      source = { ...agent, status };
    },
    continueAgent: async () => undefined,
    createConversation: async () => {
      throw new Error("not used");
    },
    createAgent: async () => {
      throw new Error("not used");
    },
    appendEntry: async (input: Record<string, unknown>) => {
      appendedEntries.push(input);
      return { ...input, id: String(input.id) };
    },
    getConversationEntries: () => appendedEntries as never,
    harnessStorage: {
      appendAgentMessage: async () => ({
        id: "entry_plan_rejected",
        timestamp: "2026-07-13T00:00:01.000Z",
      }),
    },
  } as never);
  return {
    service,
    review,
    get source() {
      return source;
    },
    resolutions,
    resumedToolCalls,
    completedToolCalls,
    appendedEntries,
    statusUpdates,
  };
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
