import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import { defaultSettings } from "@nervekit/contracts/settings";
import { ToolService } from "../../../src/domains/tools/execution/tool-service.js";
import { RUN_CANCELLED_TOOL_OUTCOME } from "../../../src/domains/tools/execution/tool-termination.js";
import { ToolResultPayloadStore } from "../../../src/domains/tools/artifacts/tool-result-payload-store.js";
import { ConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";
import { ToolCallRepository } from "../../../src/domains/tools/artifacts/tool-call.repository.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/index.js";

describe("tool service lifecycle", () => {
  it("records pre-execution provider tool-call errors as terminal tool records", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-error-"));
    const events: Array<{ type: string; data: unknown }> = [];
    const testAgent = agent("autonomous");
    const storage = {
      paths: storagePaths(home),
      settings: defaultSettings,
      localToken: "test",
    };
    const journal = new ConversationJournalRepository(storage);
    const resultPayloads = new ToolResultPayloadStore(home);
    const service = new ToolService({
      events: {
        publish: async (type: string, data: unknown) =>
          events.push({ type, data }),
      } as never,
      tasks: {} as never,
      pythonRuntime: {
        runtimeForProject: async () => undefined,
        isAvailableForProject: async () => false,
        statusSnapshot: () => ({
          available: false,
          source: "unavailable",
          error: "not used",
        }),
        refresh: async () => ({
          available: false,
          source: "unavailable",
          error: "not used",
        }),
      } as never,
      startTask: async () => {
        throw new Error("not used");
      },
      getAgent: () => testAgent,
      runExplore: async () => {
        throw new Error("not used");
      },
      getApiKey: async () => undefined,
      explainImage: {} as never,
      generateImage: {} as never,
      storage,
      plans: {} as never,
      setAgentMode: async () => testAgent,
      conversationRuntime: {} as never,
      journal,
      resultPayloads,
      toolCallRepository: new ToolCallRepository(journal, resultPayloads),
    });

    const toolCall = await service.recordProviderToolCallError(
      testAgent,
      "edit",
      {
        path: "src/file.ts",
        edits: [{ oldText: "a", newText: "b", note: "bad" }],
      },
      "Validation failed for tool edit.",
      {
        providerToolCallId: "provider_call_1",
        sourceToolCallId: "provider_call_1",
        anchor: {
          runId: "run_01H00000000000000000000000",
          turnId: "turn_01H0000000000000000000000",
          liveMessageId: "msg_01H00000000000000000000000",
          contentIndex: 2,
          providerToolCallId: "provider_call_1",
        },
      },
    );

    assert.equal(toolCall.status, "failed");
    assert.equal(toolCall.sourceToolCallId, "provider_call_1");
    assert.equal(toolCall.providerToolCallId, "provider_call_1");
    assert.equal(toolCall.error, "Validation failed for tool edit.");
    assert.deepEqual(toolCall.errorDetails, {
      code: "INVALID_TOOL_ARGUMENTS",
      message: "Validation failed for tool edit.",
    });
    assert.deepEqual(toolCall.args, {
      path: "src/file.ts",
      edits: [{ oldText: "a", newText: "b", note: "bad" }],
    });
    // The resolved anchor must survive on the stored record: the transcript
    // renderer keys the tool's row by (liveMessageId, contentIndex).
    assert.equal(toolCall.runId, "run_01H00000000000000000000000");
    assert.equal(toolCall.turnId, "turn_01H0000000000000000000000");
    assert.equal(toolCall.liveMessageId, "msg_01H00000000000000000000000");
    assert.equal(toolCall.contentIndex, 2);
    assert.equal(
      service.findToolCallByProviderToolCallId("provider_call_1")?.id,
      toolCall.id,
    );
    const update = events.find((event) => event.type === "toolCall.updated");
    assert.ok(update);
    const payload = update.data as {
      runId?: string;
      turnId?: string;
      liveMessageId?: string;
      contentIndex?: number;
      toolCall: {
        runId?: string;
        turnId?: string;
        liveMessageId?: string;
        contentIndex?: number;
      };
    };
    // Both the envelope and the embedded transcript record carry the anchor.
    assert.equal(payload.runId, "run_01H00000000000000000000000");
    assert.equal(payload.turnId, "turn_01H0000000000000000000000");
    assert.equal(payload.liveMessageId, "msg_01H00000000000000000000000");
    assert.equal(payload.contentIndex, 2);
    assert.equal(payload.toolCall.runId, "run_01H00000000000000000000000");
    assert.equal(payload.toolCall.turnId, "turn_01H0000000000000000000000");
    assert.equal(
      payload.toolCall.liveMessageId,
      "msg_01H00000000000000000000000",
    );
    assert.equal(payload.toolCall.contentIndex, 2);

    const database = new DatabaseSync(join(home, "data", "nerve.sqlite"));
    const stored = database
      .prepare(`SELECT data FROM conversation_records WHERE id = ?`)
      .get(toolCall.id) as { data: Uint8Array };
    database.close();
    assert.match(
      Buffer.from(stored.data).toString("utf8"),
      /Validation failed for tool edit/,
    );
  });

  it("routes python_exec through the workbench runtime override", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-python-"));
    const testAgent = agent("autonomous");
    const runtimeProjects: string[] = [];
    const { service } = buildToolService(home, testAgent, undefined, {
      runtimeForProject: async (projectDir: string) => {
        runtimeProjects.push(projectDir);
        return undefined;
      },
    });

    const response = await service.requestTool(testAgent, "python_exec", {
      code: "print('ok')",
    });

    assert.deepEqual(runtimeProjects, [testAgent.projectDir]);
    assert.equal(response.toolCall.status, "failed");
    assert.equal(response.toolCall.error, "Python runtime is not available.");
  });

  it("force-stages policy-allowed tools for approval", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-force-approval-"));
    const testAgent = agent("autonomous");
    const { service, events } = buildToolService(home, testAgent);

    const response = await service.requestTool(
      testAgent,
      "todos_set",
      { todos: [{ todo: "stage me", done: false }] },
      { forceApproval: true, durableSuspend: true },
    );

    assert.equal(response.toolCall.status, "waiting");
    assert.equal(response.approval?.status, "pending");
    assert.equal(service.listApprovals("pending").length, 1);
    assert.equal(
      (
        events.find((event) => event.type === "policy.evaluated")?.data as {
          decision?: string;
        }
      ).decision,
      "approval",
    );
  });

  it("keeps an abandoned interaction durable when update publication fails", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-abandon-publish-"));
    const testAgent = agent("autonomous");
    let publicationFails = false;
    const warnings: Array<{ message: string; context: unknown }> = [];
    const { service } = buildToolService(
      home,
      testAgent,
      {
        publish: async () => {
          if (publicationFails) throw new Error("secret publication body");
        },
      },
      undefined,
      {
        info: async () => undefined,
        warn: async (message: string, context: unknown) => {
          warnings.push({ message, context });
        },
      },
    );
    const pending = await service.requestTool(
      testAgent,
      "todos_set",
      { todos: [{ todo: "stage me", done: false }] },
      { forceApproval: true, durableSuspend: true },
    );

    publicationFails = true;
    const failed = await service.abandonPendingInteraction(
      pending.toolCall.id,
      "Run no longer accepts input.",
    );

    assert.equal(failed.status, "failed");
    assert.equal(failed.interactions[0]?.status, "cancelled");
    assert.equal(service.getToolCall(failed.id)?.status, "failed");
    assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0], {
      message: "Tool call update publication failed",
      context: {
        toolCallId: failed.id,
        context: {
          operation: "abandon_pending_interaction",
          failureType: "Error",
        },
      },
    });
    assert.doesNotMatch(JSON.stringify(warnings), /secret publication body/);
  });

  it("retains agent previews for policy and user denials", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-denials-"));
    const readOnlyAgent = agent("read_only");
    const { service } = buildToolService(home, readOnlyAgent);

    const policy = await service.requestTool(readOnlyAgent, "bash", {
      command: "printf x > file.txt",
    });
    assert.equal(policy.toolCall.status, "denied");
    assert.equal(policy.toolCall.phase, "denied");
    assert.match(
      previewText(policy.toolCall),
      /^Permission policy denied the requested tool call\./,
    );
    assert.equal(policy.toolCall.agentProjection?.profile, "terminal_outcome");
    assert.equal(policy.toolCall.resultPayload, undefined);

    const supervisedAgent = agent("autonomous");
    const { service: approvalService, journalCommit } = buildToolService(
      await mkdtemp(join(tmpdir(), "nerve-tool-user-denial-")),
      supervisedAgent,
    );
    const pending = await approvalService.requestTool(
      supervisedAgent,
      "todos_set",
      { todos: [{ todo: "do not apply", done: false }] },
      { forceApproval: true, durableSuspend: true },
    );
    const { toolCall: denied } = await approvalService.projectApprovalDecision(
      {
        toolCallId: pending.toolCall.id,
        ordinal: 0,
        decision: "deny",
        note: "Not now.",
        resolutionRequestId: "deny-1",
      },
      journalCommit,
    );
    assert.equal(denied.status, "denied");
    assert.equal(denied.supervision?.source, "user");
    assert.match(previewText(denied), /^User denied the requested tool call\./);
    assert.equal(denied.resultPayload, undefined);
  });

  it("replays a repeated approval decision and rejects a conflicting one", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-resolution-denial-"));
    const testAgent = agent("autonomous");
    const { service, journalCommit } = buildToolService(home, testAgent);
    const pending = await service.requestTool(
      testAgent,
      "todos_set",
      { todos: [{ todo: "do not apply", done: false }] },
      { forceApproval: true, durableSuspend: true },
    );
    const decide = (decision: "allow" | "deny", resolutionRequestId: string) =>
      service.projectApprovalDecision(
        {
          toolCallId: pending.toolCall.id,
          ordinal: 0,
          expectedRevision: pending.toolCall.revision,
          decision,
          note: "No.",
          resolutionRequestId,
        },
        journalCommit,
      );

    const first = await decide("deny", "deny-resolution-1");
    const replay = await decide("deny", "deny-resolution-1");

    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.toolCall.revision, first.toolCall.revision);
    assert.equal(first.toolCall.status, "denied");
    assert.equal(first.toolCall.supervision?.source, "user");
    await assert.rejects(decide("allow", "allow-1"), /already resolved/);
    await assert.rejects(
      service.resolveInteraction({
        toolCallId: pending.toolCall.id,
        interactionOrdinal: 0,
        expectedRevision: first.toolCall.revision,
        resolutionRequestId: "generic",
        resolution: { kind: "approval", action: "allow" },
      }),
      /projectApprovalDecision/,
    );
  });

  it("claims an approved draft only once and never dispatches a pending one", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-claim-"));
    const testAgent = agent("autonomous");
    const { service, journalCommit } = buildToolService(home, testAgent);
    const pending = await service.requestTool(
      testAgent,
      "todos_set",
      { todos: [{ todo: "apply", done: false }] },
      { forceApproval: true, durableSuspend: true },
    );
    await assert.rejects(
      service.claimApprovedExecution(pending.toolCall.id),
      /durably approved draft/,
    );
    await service.projectApprovalDecision(
      {
        toolCallId: pending.toolCall.id,
        ordinal: 0,
        decision: "allow",
        resolutionRequestId: "allow-1",
      },
      journalCommit,
    );
    const claims = await Promise.allSettled([
      service.claimApprovedExecution(pending.toolCall.id),
      service.claimApprovedExecution(pending.toolCall.id),
    ]);
    assert.deepEqual(
      claims.map((claim) => claim.status),
      ["fulfilled", "rejected"],
    );
    assert.equal(
      (claims[0] as PromiseFulfilledResult<ToolCallRecord>).value.status,
      "running",
    );
  });

  it("reads approval and revision inside the claim while a decision commit holds the lock", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-claim-lock-"));
    const testAgent = agent("autonomous");
    const { service, journalCommit } = buildToolService(home, testAgent);
    const pending = await service.requestTool(
      testAgent,
      "todos_set",
      { todos: [{ todo: "apply", done: false }] },
      { forceApproval: true, durableSuspend: true },
    );
    let releaseCommit!: () => void;
    const commitHeld = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    let enteredCommit!: () => void;
    const inCommit = new Promise<void>((resolve) => {
      enteredCommit = resolve;
    });
    const decision = service.projectApprovalDecision(
      {
        toolCallId: pending.toolCall.id,
        ordinal: 0,
        decision: "allow",
        resolutionRequestId: "allow-held",
      },
      async (next, events) => {
        enteredCommit();
        await commitHeld;
        await journalCommit(next, events);
      },
    );
    await inCommit;
    // The cached record is still the pending revision here.
    assert.equal(service.getToolCall(pending.toolCall.id).status, "waiting");
    let observed: ToolCallRecord | undefined;
    const claim = service.claimApprovedExecution(
      pending.toolCall.id,
      async (current) => {
        observed = current;
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(observed, undefined);
    releaseCommit();
    const decided = await decision;
    const claimed = await claim;
    assert.equal(observed?.revision, decided.toolCall.revision);
    assert.equal(observed?.supervision?.status, "approved");
    assert.equal(claimed.status, "running");
    assert.equal(claimed.revision, decided.toolCall.revision + 1);
  });

  it("classifies a claimed cancellation from the locked record and rejects late success", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-cancel-claimed-"));
    const { service, journalCommit } = buildToolService(
      home,
      agent("autonomous"),
    );
    const runId = "run_cancel_claimed";
    const draft = await service.requestTool(
      agent("autonomous"),
      "todos_set",
      {
        todos: [{ todo: "apply", done: false }],
      },
      { forceApproval: true, durableSuspend: true, runId },
    );
    await service.projectApprovalDecision(
      {
        toolCallId: draft.toolCall.id,
        ordinal: 0,
        decision: "allow",
        resolutionRequestId: "allow-claimed",
      },
      journalCommit,
    );
    const claimed = await service.claimApprovedExecution(draft.toolCall.id);
    assert.ok(claimed.execution?.executionId);
    const [terminal] = await service.terminateNonTerminalToolCallsForRun(
      runId,
      RUN_CANCELLED_TOOL_OUTCOME,
    );
    assert.equal(terminal?.status, "cancelled");
    assert.equal(terminal?.errorDetails?.code, "TOOL_OUTCOME_UNKNOWN");
    assert.equal(terminal?.errorDetails?.details?.phase, "post_dispatch");
    assert.match(
      terminal?.error ?? "",
      /external outcome is unknown; inspect the target/,
    );
    assert.match(previewText(terminal), /external outcome is unknown/);
    await assert.rejects(
      service.completeToolCall(claimed.id, { content: "late success" }),
    );
    assert.deepEqual(await service.getToolCallDetails(claimed.id), terminal);
    assert.deepEqual(
      await service.terminateNonTerminalToolCallsForRun(
        runId,
        RUN_CANCELLED_TOOL_OUTCOME,
      ),
      [],
    );
  });

  it("serializes a waiting claim and cancellation; cancelled drafts are never claimable", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-cancel-race-"));
    const { service, journalCommit } = buildToolService(
      home,
      agent("autonomous"),
    );
    const runId = "run_cancel_race";
    const draft = await service.requestTool(
      agent("autonomous"),
      "todos_set",
      {
        todos: [{ todo: "apply", done: false }],
      },
      { forceApproval: true, durableSuspend: true, runId },
    );
    await service.projectApprovalDecision(
      {
        toolCallId: draft.toolCall.id,
        ordinal: 0,
        decision: "allow",
        resolutionRequestId: "allow-race",
      },
      journalCommit,
    );
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const claim = service.claimApprovedExecution(
      draft.toolCall.id,
      async () => {
        enter();
        await held;
      },
    );
    await entered;
    const cancellation = service.terminateNonTerminalToolCallsForRun(
      runId,
      RUN_CANCELLED_TOOL_OUTCOME,
    );
    release();
    await claim;
    const [terminal] = await cancellation;
    assert.equal(terminal?.errorDetails?.code, "TOOL_OUTCOME_UNKNOWN");
    assert.match(previewText(terminal), /external outcome is unknown/);

    const secondRun = "run_cancel_before_claim";
    const second = await service.requestTool(
      agent("autonomous"),
      "todos_set",
      {
        todos: [{ todo: "skip", done: false }],
      },
      { forceApproval: true, durableSuspend: true, runId: secondRun },
    );
    await service.projectApprovalDecision(
      {
        toolCallId: second.toolCall.id,
        ordinal: 0,
        decision: "allow",
        resolutionRequestId: "allow-before-cancel",
      },
      journalCommit,
    );
    const [unclaimed] = await service.terminateNonTerminalToolCallsForRun(
      secondRun,
      RUN_CANCELLED_TOOL_OUTCOME,
    );
    assert.equal(unclaimed?.errorDetails?.code, "TOOL_NOT_DISPATCHED");
    assert.match(previewText(unclaimed), /not executed/);
    await assert.rejects(service.claimApprovedExecution(second.toolCall.id));
  });

  it("preserves a committed result when cancellation loses the race", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-cancel-result-"));
    const { service, journalCommit } = buildToolService(
      home,
      agent("autonomous"),
    );
    const runId = "run_cancel_result";
    const draft = await service.requestTool(
      agent("autonomous"),
      "todos_set",
      {
        todos: [{ todo: "apply", done: false }],
      },
      { forceApproval: true, durableSuspend: true, runId },
    );
    await service.projectApprovalDecision(
      {
        toolCallId: draft.toolCall.id,
        ordinal: 0,
        decision: "allow",
        resolutionRequestId: "allow-result",
      },
      journalCommit,
    );
    await service.claimApprovedExecution(draft.toolCall.id);
    const completed = await service.completeToolCall(draft.toolCall.id, {
      content: "done",
    });
    assert.deepEqual(
      await service.terminateNonTerminalToolCallsForRun(
        runId,
        RUN_CANCELLED_TOOL_OUTCOME,
      ),
      [],
    );
    assert.deepEqual(await service.getToolCallDetails(completed.id), completed);
  });

  it("cancels pending interactions when terminalizing a run", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-terminalize-"));
    const testAgent = agent("autonomous");
    const { service } = buildToolService(home, testAgent);
    const runId = "run_01H00000000000000000000000";

    const response = await service.requestTool(
      testAgent,
      "todos_set",
      { todos: [{ todo: "stage me", done: false }] },
      { forceApproval: true, durableSuspend: true, runId },
    );
    assert.equal(response.toolCall.status, "waiting");
    assert.equal(response.toolCall.interactions[0]?.status, "pending");

    const [terminal] = await service.terminateNonTerminalToolCallsForRun(
      runId,
      {
        status: "cancelled",
        code: "cancelled",
        message: "Run was cancelled.",
      },
    );

    assert.equal(terminal?.status, "cancelled");
    assert.equal(terminal?.phase, "cancelled");
    assert.match(terminal?.error ?? "", /not executed/);
    assert.equal(terminal?.errorDetails?.code, "TOOL_NOT_DISPATCHED");
    assert.equal(terminal?.errorDetails?.details?.phase, "pre_dispatch");
    assert.deepEqual(terminal?.result, {
      content: terminal?.error,
      contentBlocks: [{ type: "text", text: terminal?.error }],
    });
    assert.equal(terminal?.interactions[0]?.status, "cancelled");
    assert.ok(terminal?.interactions[0]?.cancelledAt);
    assert.ok(terminal?.settledAt);
    assert.match(previewText(terminal), /not executed/);
    assert.equal(terminal?.agentProjection?.profile, "terminal_outcome");
    assert.equal(terminal?.resultPayload, undefined);
  });
});

function previewText(toolCall: ToolCallRecord | undefined): string {
  return (
    toolCall?.agentPreview?.blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n") ?? ""
  );
}

function buildToolService(
  home: string,
  testAgent: AgentRecord,
  publisher?: { publish(type: string, data: unknown): Promise<unknown> },
  pythonRuntime?: {
    runtimeForProject(projectDir: string): Promise<undefined>;
  },
  logger?: {
    info(message: string, context: unknown): Promise<void>;
    warn(message: string, context: unknown): Promise<void>;
  },
) {
  const events: Array<{ type: string; data: unknown }> = [];
  const storage = {
    paths: storagePaths(home),
    settings: defaultSettings,
    localToken: "test",
  };
  const journal = new ConversationJournalRepository(storage);
  const resultPayloads = new ToolResultPayloadStore(home);
  const service = new ToolService({
    events: (publisher ?? {
      publish: async (type: string, data: unknown) =>
        events.push({ type, data }),
    }) as never,
    tasks: {} as never,
    pythonRuntime: (pythonRuntime ?? {
      runtimeForProject: async () => undefined,
      isAvailableForProject: async () => false,
      statusSnapshot: () => ({
        available: false,
        source: "unavailable",
        error: "not used",
      }),
      refresh: async () => ({
        available: false,
        source: "unavailable",
        error: "not used",
      }),
    }) as never,
    startTask: async () => {
      throw new Error("not used");
    },
    getAgent: () => testAgent,
    runExplore: async () => {
      throw new Error("not used");
    },
    getApiKey: async () => undefined,
    explainImage: {} as never,
    generateImage: {} as never,
    storage,
    plans: {} as never,
    setAgentMode: async () => testAgent,
    conversationRuntime: {} as never,
    logger: logger as never,
    journal,
    resultPayloads,
    toolCallRepository: new ToolCallRepository(journal, resultPayloads),
  });
  const journalCommit = async (
    next: { conversationId: string },
    journalEvents: import("@nervekit/contracts/conversations").ConversationJournalEvent[],
  ) => {
    await journal.commit(next.conversationId, {
      kind: "tool_call.revised",
      events: journalEvents,
    });
  };
  return { service, events, journalCommit };
}

function agent(permissionLevel: AgentRecord["permissionLevel"]): AgentRecord {
  return {
    id: "agent_01HN0000000000000000000000",
    conversationId: "conv_01HN0000000000000000000000",
    projectId: "proj_01HN0000000000000000000000",
    projectDir: "/tmp/project",
    rootAgentId: "agent_01HN0000000000000000000000",
    mode: "coding",
    permissionLevel,
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3 },
    status: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
