import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { clampAgentThinkingLevel } from "@nervekit/agent";
import type {
  ConversationEntry,
  EventEnvelope,
  ToolCallRecord,
} from "@nervekit/shared";
import { initializeStorage } from "../src/infrastructure/storage/index.js";
import { HttpError } from "../src/http/errors.js";
import { createOrchestratorState } from "../src/app/orchestrator-state.js";

const roots: string[] = [];
const modelA = { provider: "nerve-faux", modelId: "faux-fast" } as const;
const modelB = {
  provider: "anthropic",
  modelId: "claude-sonnet-4-5",
} as const;

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempHome(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function createState(prefix = "nerve-registry-agent-") {
  const storage = await initializeStorage(await tempHome(prefix));
  const state = createOrchestratorState(storage, "127.0.0.1", 0);
  await state.registry.hydrate();
  return state;
}

async function createProjectConversationAgent() {
  const state = await createState();
  const project = await state.registry.createProject({
    dir: state.storage.paths.home,
  });
  const conversation = await state.registry.createConversation({
    projectId: project.id,
  });
  const agent = await state.registry.createAgent({
    projectId: project.id,
    conversationId: conversation.id,
  });
  return { state, project, conversation, agent };
}

describe("RuntimeRegistry agent run state", () => {
  it("rejects a new prompt while an agent is already busy", async () => {
    const { state, agent } = await createProjectConversationAgent();
    try {
      state.registry.runs.set(agent.id, {
        runId: "run_01HN0000000000000000000000",
        abort: () => undefined,
        messages: [],
      });

      await assert.rejects(
        () => state.registry.promptAgent(agent.id, { text: "again" }),
        (error) =>
          error instanceof HttpError &&
          error.status === 409 &&
          error.code === "AGENT_BUSY",
      );
    } finally {
      state.index.close();
    }
  });

  it("allows mode-only updates while an agent is running", async () => {
    const { state, agent } = await createProjectConversationAgent();
    let runtimeMode: string | undefined;
    try {
      state.registry.runs.set(agent.id, {
        runId: "run_01HN0000000000000000000000",
        abort: () => undefined,
        messages: [],
        updateAgentRuntimeConfig: async (updated) => {
          runtimeMode = updated.mode;
        },
      });

      const updated = await state.registry.configureAgent(agent.id, {
        mode: "planning",
      });

      assert.equal(updated.mode, "planning");
      assert.equal(state.registry.getAgent(agent.id).mode, "planning");
      assert.equal(runtimeMode, "planning");
    } finally {
      state.index.close();
    }
  });

  it("still rejects permission config updates while an agent is running", async () => {
    const { state, agent } = await createProjectConversationAgent();
    try {
      state.registry.runs.set(agent.id, {
        runId: "run_01HN0000000000000000000000",
        abort: () => undefined,
        messages: [],
      });

      await assert.rejects(
        () =>
          state.registry.configureAgent(agent.id, {
            permissionLevel: "supervised",
          }),
        (error) =>
          error instanceof HttpError &&
          error.status === 409 &&
          error.code === "AGENT_BUSY",
      );
    } finally {
      state.index.close();
    }
  });

  it("allows model and thinking updates while an agent is running", async () => {
    const { state, agent } = await createProjectConversationAgent();
    let runtimeAgent: typeof agent | undefined;
    try {
      state.registry.runs.set(agent.id, {
        runId: "run_01HN0000000000000000000000",
        abort: () => undefined,
        messages: [],
        updateAgentRuntimeConfig: async (updated) => {
          runtimeAgent = updated;
        },
      });

      const updated = await state.registry.configureAgent(agent.id, {
        model: modelB,
        thinkingLevel: "high",
      });
      const expectedThinkingLevel = clampAgentThinkingLevel(modelB, "high");

      assert.deepEqual(updated.model, modelB);
      assert.equal(updated.thinkingLevel, expectedThinkingLevel);
      assert.deepEqual(state.registry.getAgent(agent.id).model, modelB);
      assert.equal(
        state.registry.getAgent(agent.id).thinkingLevel,
        expectedThinkingLevel,
      );
      assert.deepEqual(runtimeAgent?.model, modelB);
      assert.equal(runtimeAgent?.thinkingLevel, expectedThinkingLevel);
    } finally {
      state.index.close();
    }
  });

  it("accepts a suspended plan by appending an implementation instruction and continuing", async () => {
    const { state, agent } = await createProjectConversationAgent();
    let continued = false;
    let continuedAtSeq: number | undefined;
    try {
      await state.registry.configureAgent(agent.id, { mode: "planning" });
      const { review, toolCall } = await createPendingPlanReviewSuspension(
        state,
        agent.id,
      );
      const startSeq = state.events.latestSeq;
      setContinueAgentMock(state, async () => {
        continued = true;
        continuedAtSeq = state.events.latestSeq;
      });

      await state.registry.acceptPlanReview(review.id);

      assert.equal(state.registry.getAgent(agent.id).mode, "coding");
      assert.equal(continued, true);
      const entries = state.registry.getConversationEntries(
        agent.conversationId,
      );
      const followUp = acceptedPlanFollowUpText(review.planPath);
      assert.ok(
        entries.some(
          (entry) => entry.role === "user" && entry.text === followUp,
        ),
      );

      const events = await state.events.replayPersistedSince(startSeq);
      const completedToolEvent = findToolCallEvent(
        events,
        toolCall.id,
        "completed",
      );
      const toolResultEntryEvent = findEntryEvent(events, (entry) => {
        const details = detailsRecord(entry);
        return (
          entry.role === "system" &&
          details.toolRecordId === toolCall.id &&
          details.toolName === "plan_mode_present"
        );
      });
      const followUpEntryEvent = findEntryEvent(
        events,
        (entry) => entry.role === "user" && entry.text === followUp,
      );

      assert.ok(completedToolEvent, "completed tool-call event was published");
      assert.ok(toolResultEntryEvent, "tool-result entry event was published");
      assert.ok(
        followUpEntryEvent,
        "accepted-plan user entry event was published",
      );
      assert.ok(
        completedToolEvent.seq < toolResultEntryEvent.seq,
        "tool result entry is published after tool-call completion",
      );
      assert.ok(
        toolResultEntryEvent.seq < followUpEntryEvent.seq,
        "follow-up user entry is published after tool result",
      );
      assert.ok(
        continuedAtSeq !== undefined &&
          followUpEntryEvent.seq <= continuedAtSeq,
        "follow-up user entry is published before agent continuation",
      );
    } finally {
      state.index.close();
    }
  });

  it("accepts a suspended plan in a new chat without continuing the original agent", async () => {
    const { state, agent } = await createProjectConversationAgent();
    const continuedAgentIds: string[] = [];
    let continuedAtSeq: number | undefined;
    try {
      await state.registry.configureAgent(agent.id, { mode: "planning" });
      const { review, suspension, toolCall } =
        await createPendingPlanReviewSuspension(state, agent.id);
      const startSeq = state.events.latestSeq;
      setContinueAgentMock(state, async (continuedAgentId) => {
        continuedAgentIds.push(continuedAgentId);
        continuedAtSeq = state.events.latestSeq;
      });

      const result = await state.registry.acceptPlanReviewInNewChat(review.id);

      assert.equal(result.planReview.status, "accepted_in_new_chat");
      assert.notEqual(result.conversation.id, agent.conversationId);
      assert.equal(result.conversation.projectId, agent.projectId);
      assert.equal(result.conversation.mode, "coding");
      assert.equal(result.agent.conversationId, result.conversation.id);
      assert.equal(result.agent.projectId, agent.projectId);
      assert.equal(result.agent.mode, "coding");
      assert.equal(result.agent.permissionLevel, agent.permissionLevel);
      assert.deepEqual(continuedAgentIds, [result.agent.id]);
      assert.equal(state.registry.getAgent(agent.id).mode, "planning");
      assert.equal(state.registry.getAgent(agent.id).status, "idle");
      assert.equal(
        state.registry.suspensions.getSuspension(suspension.id).status,
        "cancelled",
      );

      const instruction = acceptedPlanInNewChatInstructionText(review.planPath);
      const newEntries = state.registry.getConversationEntries(
        result.conversation.id,
      );
      assert.ok(
        newEntries.some(
          (entry) => entry.role === "user" && entry.text === instruction,
        ),
      );

      const events = await state.events.replayPersistedSince(startSeq);
      const completedToolEvent = findToolCallEvent(
        events,
        toolCall.id,
        "completed",
      );
      const instructionEntryEvent = findEntryEvent(
        events,
        (entry) =>
          entry.conversationId === result.conversation.id &&
          entry.role === "user" &&
          entry.text === instruction,
      );
      assert.ok(completedToolEvent, "completed tool-call event was published");
      assert.ok(
        instructionEntryEvent,
        "new-chat instruction entry event was published",
      );
      assert.ok(
        continuedAtSeq !== undefined &&
          instructionEntryEvent.seq <= continuedAtSeq,
        "new-chat instruction entry is published before agent continuation",
      );
    } finally {
      state.index.close();
    }
  });

  it("accepts a suspended plan with a selected implementation model in the same conversation", async () => {
    const { state, agent } = await createProjectConversationAgent();
    const continuedAgentIds: string[] = [];
    let continuedAtSeq: number | undefined;
    try {
      await state.registry.configureAgent(agent.id, {
        mode: "planning",
        model: modelA,
        thinkingLevel: "off",
      });
      const { review } = await createPendingPlanReviewSuspension(
        state,
        agent.id,
      );
      const startSeq = state.events.latestSeq;
      setContinueAgentMock(state, async (continuedAgentId) => {
        continuedAgentIds.push(continuedAgentId);
        continuedAtSeq = state.events.latestSeq;
      });

      await state.registry.acceptPlanReview(review.id, undefined, {
        implementationModel: modelB,
        implementationThinkingLevel: "high",
      });
      const expectedThinkingLevel = clampAgentThinkingLevel(modelB, "high");
      const updatedAgent = state.registry.getAgent(agent.id);

      assert.equal(updatedAgent.mode, "coding");
      assert.deepEqual(updatedAgent.model, modelB);
      assert.equal(updatedAgent.thinkingLevel, expectedThinkingLevel);
      assert.deepEqual(continuedAgentIds, [agent.id]);

      const events = await state.events.replayPersistedSince(startSeq);
      const configuredEvent = events.find((event) => {
        if (event.type !== "agent.configured") return false;
        const data = event.data as { agent?: { id?: string } };
        return data.agent?.id === agent.id;
      });
      assert.ok(configuredEvent, "implementation model update was published");
      assert.ok(
        continuedAtSeq !== undefined && configuredEvent.seq <= continuedAtSeq,
        "implementation model is applied before agent continuation",
      );
    } finally {
      state.index.close();
    }
  });

  it("accepts a suspended plan in a new chat with a selected implementation model", async () => {
    const { state, agent } = await createProjectConversationAgent();
    const continuedAgentIds: string[] = [];
    try {
      await state.registry.configureAgent(agent.id, {
        mode: "planning",
        model: modelA,
        thinkingLevel: "off",
      });
      const { review } = await createPendingPlanReviewSuspension(
        state,
        agent.id,
      );
      setContinueAgentMock(state, async (continuedAgentId) => {
        continuedAgentIds.push(continuedAgentId);
      });

      const result = await state.registry.acceptPlanReviewInNewChat(
        review.id,
        undefined,
        {
          implementationModel: modelB,
          implementationThinkingLevel: "high",
        },
      );
      const expectedThinkingLevel = clampAgentThinkingLevel(modelB, "high");
      const sourceAgent = state.registry.getAgent(agent.id);

      assert.equal(result.conversation.mode, "coding");
      assert.equal(result.agent.mode, "coding");
      assert.deepEqual(result.agent.model, modelB);
      assert.equal(result.agent.thinkingLevel, expectedThinkingLevel);
      assert.equal(sourceAgent.mode, "planning");
      assert.deepEqual(sourceAgent.model, modelA);
      assert.equal(sourceAgent.thinkingLevel, "off");
      assert.deepEqual(continuedAgentIds, [result.agent.id]);
    } finally {
      state.index.close();
    }
  });

  it("rejects a suspended plan without changing mode or continuing", async () => {
    const { state, agent } = await createProjectConversationAgent();
    let continued = false;
    try {
      await state.registry.configureAgent(agent.id, { mode: "planning" });
      const { review, suspension } = await createPendingPlanReviewSuspension(
        state,
        agent.id,
      );
      const startSeq = state.events.latestSeq;
      setContinueAgentMock(state, async () => {
        continued = true;
      });

      await state.registry.rejectPlanReview(review.id);

      assert.equal(state.registry.getAgent(agent.id).mode, "planning");
      assert.equal(state.registry.getAgent(agent.id).status, "idle");
      assert.equal(continued, false);
      assert.equal(
        state.registry.suspensions.getSuspension(suspension.id).status,
        "cancelled",
      );
      const events = await state.events.replayPersistedSince(startSeq);
      const statusEvent = events.find(
        (event) => event.type === "agent.status_changed",
      );
      assert.ok(statusEvent, "agent status event was published");
      const statusData = statusEvent.data as {
        agent?: { id?: string; status?: string };
        agentId?: string;
        status?: string;
      };
      assert.equal(statusData.agentId, agent.id);
      assert.equal(statusData.status, "idle");
      assert.equal(statusData.agent?.id, agent.id);
      assert.equal(statusData.agent?.status, "idle");
    } finally {
      state.index.close();
    }
  });

  it("answers a suspended user question by publishing the tool-result entry before continuing", async () => {
    const { state, agent } = await createProjectConversationAgent();
    let continued = false;
    let continuedAtSeq: number | undefined;
    try {
      const { toolCall } = await state.registry.tools.requestTool(
        agent,
        "ask_user",
        {
          question: "Which option should I use?",
          context: "Testing the suspended ask_user path.",
        },
        {
          runId: "run_01HN0000000000000000000000",
          turnId: "turn_01HN0000000000000000000000",
          providerToolCallId: "call_question",
          durableSuspend: true,
        },
      );
      const question = state.registry.tools
        .listUserQuestions("pending")
        .find((candidate) => candidate.toolCallId === toolCall.id);
      assert.ok(question, "pending question was created");
      await state.registry.suspensions.createSuspension({
        agentId: agent.id,
        conversationId: agent.conversationId,
        projectId: agent.projectId,
        runId: "run_01HN0000000000000000000000",
        turnId: "turn_01HN0000000000000000000000",
        toolCallId: toolCall.id,
        providerToolCallId: "call_question",
        toolName: "ask_user",
        remainingToolCalls: [],
        reason: "Tool ask_user is awaiting user input.",
      });
      const startSeq = state.events.latestSeq;
      setContinueAgentMock(state, async () => {
        continued = true;
        continuedAtSeq = state.events.latestSeq;
      });

      await state.registry.answerUserQuestion(question.id, "Use option B.");

      assert.equal(continued, true);
      const events = await state.events.replayPersistedSince(startSeq);
      const completedToolEvent = findToolCallEvent(
        events,
        toolCall.id,
        "completed",
      );
      const toolResultEntryEvent = findEntryEvent(events, (entry) => {
        const details = detailsRecord(entry);
        return (
          entry.role === "system" &&
          details.toolRecordId === toolCall.id &&
          details.toolName === "ask_user"
        );
      });

      assert.ok(completedToolEvent, "completed ask_user event was published");
      assert.ok(
        toolResultEntryEvent,
        "ask_user result entry event was published",
      );
      assert.ok(
        completedToolEvent.seq < toolResultEntryEvent.seq,
        "ask_user result entry is published after tool-call completion",
      );
      assert.ok(
        continuedAtSeq !== undefined &&
          toolResultEntryEvent.seq <= continuedAtSeq,
        "ask_user result entry is published before agent continuation",
      );
    } finally {
      state.index.close();
    }
  });

  it("treats aborting an idle agent as a no-op", async () => {
    const { state, agent } = await createProjectConversationAgent();
    try {
      await state.registry.abortAgent(agent.id);
      await state.registry.abortAgent(agent.id);
      assert.equal(state.registry.getAgent(agent.id).status, "idle");
    } finally {
      state.index.close();
    }
  });

  it("waits for running child agents before aborting the parent run", async () => {
    const { state, project, conversation, agent } =
      await createProjectConversationAgent();
    const events: string[] = [];
    try {
      const child = await state.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        parentAgentId: agent.id,
      });
      state.registry.runs.set(child.id, {
        runId: "run_01HN0000000000000000000001",
        abort: async () => {
          events.push("child:start");
          await Promise.resolve();
          events.push("child:done");
        },
        messages: [],
      });
      state.registry.runs.set(agent.id, {
        runId: "run_01HN0000000000000000000002",
        abort: () => {
          events.push("parent");
        },
        messages: [],
      });

      await state.registry.abortAgent(agent.id);

      assert.deepEqual(events, ["child:start", "child:done", "parent"]);
    } finally {
      state.index.close();
    }
  });

  it("enforces child-agent budget and authority constraints", async () => {
    const { state, project, conversation } =
      await createProjectConversationAgent();
    try {
      const exhaustedParent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        budget: { depth: 0, maxDepth: 3, maxRuns: 1, usedRuns: 1 },
      });
      await assert.rejects(
        () =>
          state.registry.createAgent({
            projectId: project.id,
            conversationId: conversation.id,
            parentAgentId: exhaustedParent.id,
          }),
        (error) =>
          error instanceof HttpError &&
          error.status === 403 &&
          error.code === "SUBAGENT_BUDGET_EXHAUSTED",
      );

      const scopedParent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        mode: "planning",
        permissionLevel: "read_only",
      });
      await assert.rejects(
        () =>
          state.registry.createAgent({
            projectId: project.id,
            conversationId: conversation.id,
            parentAgentId: scopedParent.id,
            mode: "coding",
            permissionLevel: "supervised",
          }),
        (error) =>
          error instanceof HttpError &&
          error.status === 403 &&
          error.code === "SUBAGENT_AUTHORITY_EXCEEDED",
      );
    } finally {
      state.index.close();
    }
  });
});

function acceptedPlanFollowUpText(planPath: string): string {
  return `The user accepted the plan at ${planPath}. Proceed with the implementation using that plan as the source of truth.`;
}

function acceptedPlanInNewChatInstructionText(planPath: string): string {
  return `The user accepted the plan at ${planPath} and chose to implement it in this new chat. Read that plan file and implement it as the source of truth.`;
}

function setContinueAgentMock(
  state: Awaited<ReturnType<typeof createState>>,
  continueAgent: (agentId: string) => Promise<void>,
): void {
  (
    state.registry as unknown as {
      agentRunner: { continueAgent: (agentId: string) => Promise<void> };
    }
  ).agentRunner.continueAgent = continueAgent;
}

function findToolCallEvent(
  events: EventEnvelope[],
  toolCallId: string,
  status: ToolCallRecord["status"],
): EventEnvelope | undefined {
  return events.find((event) => {
    if (event.type !== "conversation.tool_call.updated") return false;
    const data = event.data as { toolCall?: ToolCallRecord };
    return data.toolCall?.id === toolCallId && data.toolCall.status === status;
  });
}

function findEntryEvent(
  events: EventEnvelope[],
  predicate: (entry: ConversationEntry) => boolean,
): EventEnvelope | undefined {
  return events.find((event) => {
    if (event.type !== "conversation.entry.appended") return false;
    const data = event.data as { entry?: ConversationEntry };
    return data.entry ? predicate(data.entry) : false;
  });
}

function detailsRecord(entry: ConversationEntry): Record<string, unknown> {
  return entry.details && typeof entry.details === "object"
    ? (entry.details as Record<string, unknown>)
    : {};
}

async function createPendingPlanReviewSuspension(
  state: Awaited<ReturnType<typeof createState>>,
  agentId: string,
) {
  const agent = state.registry.getAgent(agentId);
  const planDir = state.registry.plans.planDir(agent);
  await mkdir(planDir, { recursive: true });
  const planPath = join(planDir, `${agent.id}-implementation.md`);
  await writeFile(planPath, "# Implementation Plan\n\nDo the work.\n", "utf8");

  const toolCall: ToolCallRecord = {
    id: "tool_01HN0000000000000000000000",
    agentId: agent.id,
    conversationId: agent.conversationId,
    projectId: agent.projectId,
    toolName: "plan_mode_present",
    risk: "interaction",
    args: { file_path: planPath },
    cwd: agent.projectDir,
    status: "waiting_for_user",
    runId: "run_01HN0000000000000000000000",
    turnId: "turn_01HN0000000000000000000000",
    sourceToolCallId: "call_plan",
    providerToolCallId: "call_plan",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await (
    state.registry.tools as unknown as {
      upsertToolCall: (toolCall: ToolCallRecord) => Promise<void>;
    }
  ).upsertToolCall(toolCall);
  const review = await state.registry.plans.createPlanReview(toolCall, agent, {
    file_path: planPath,
  });
  const suspension = await state.registry.suspensions.createSuspension({
    agentId: agent.id,
    conversationId: agent.conversationId,
    projectId: agent.projectId,
    runId: "run_01HN0000000000000000000000",
    turnId: "turn_01HN0000000000000000000000",
    toolCallId: toolCall.id,
    providerToolCallId: "call_plan",
    toolName: "plan_mode_present",
    remainingToolCalls: [],
    reason: "Tool plan_mode_present is awaiting user input.",
  });
  return { review, suspension, toolCall };
}
