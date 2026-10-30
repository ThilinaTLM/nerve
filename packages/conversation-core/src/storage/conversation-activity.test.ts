import assert from "node:assert/strict";
import test from "node:test";
import type { CoreChange } from "../runtime/core-change.js";
import { StatusService } from "../runtime/status.js";
import { InputQueueService } from "../inputs/input-queue.service.js";
import { openCoreStorage } from "./core-storage.js";

const at = "2026-10-10T00:00:00.000Z";
function fixture() {
  const storage = openCoreStorage(":memory:");
  storage.projects.insert({
    id: "p",
    name: "P",
    directory: "/tmp",
    createdAt: at,
    updatedAt: at,
  });
  for (const [id, parentConversationId] of [
    ["root", null],
    ["child", "root"],
    ["grandchild", "child"],
  ] as const) {
    storage.conversations.insert(
      {
        id,
        projectId: "p",
        parentConversationId,
        parentToolCallId: null,
        headEventId: null,
        title: `${id} title`,
        status: "idle",
        statusEventSequence: 0,
        statusClearedAt: null,
        paused: false,
        nextInputSequence: 1,
        pinnedAt: null,
        completedAt: null,
        lastUserMessageAt: null,
        createdAt: at,
        updatedAt: at,
      },
      {
        conversationId: id,
        model: { provider: "test", modelId: "test" },
        reasoningLevel: "off",
        systemPrompt: null,
        instructions: null,
        permissionRuleSetId: "baseline",
        agentProfile: "coding",
        workingDirectory: "/tmp",
      },
    );
  }
  const changes: CoreChange[] = [];
  const emit = (change: CoreChange) => {
    changes.push(change);
  };
  const inputs = new InputQueueService({
    storage,
    processes: {} as never,
    emit,
    requestWake() {},
  });
  return {
    storage,
    changes,
    emit,
    inputs,
    summary: () => storage.conversations.getSummary("root")!,
  };
}

test("summary reads include running bash and wake inputs recursively, respecting pause", () => {
  const f = fixture();
  try {
    assert.equal(f.summary().pendingWork, false);
    f.storage.asyncBash.insert({
      id: "bash",
      conversationId: "grandchild",
      toolCallId: "tool",
      command: "echo hi",
      workingDirectory: "/tmp",
      processRef: null,
      status: "running",
      exitCode: null,
      startedAt: at,
      finishedAt: null,
    });
    assert.equal(f.summary().pendingWork, true);
    f.storage.conversations.update("grandchild", { paused: true });
    assert.equal(
      f.summary().pendingWork,
      true,
      "pause does not hide a running command",
    );
    f.storage.asyncBash.update("bash", {
      status: "completed",
      exitCode: 0,
      finishedAt: at,
    });
    assert.equal(f.summary().pendingWork, false);
    f.inputs.submit({
      conversationId: "grandchild",
      inputId: "wake",
      source: "parent_conversation",
      senderConversationId: "child",
      text: "Resume",
      wakeWhenIdle: true,
    });
    assert.equal(
      f.summary().pendingWork,
      false,
      "paused wake input does not resume work",
    );
    f.storage.conversations.update("grandchild", { paused: false });
    assert.equal(f.summary().pendingWork, true);
    assert.equal(
      f.storage.conversations.list({ projectId: "p" })[0]!.pendingWork,
      true,
    );
    f.inputs.deliver("grandchild", { kind: "turn" });
    assert.equal(f.summary().pendingWork, false);
    f.inputs.submit({
      conversationId: "root",
      inputId: "silent",
      source: "user",
      text: "Not waking",
      wakeWhenIdle: false,
    });
    assert.equal(f.summary().pendingWork, false);
    for (const status of ["running", "waiting"] as const) {
      f.storage.conversations.update("grandchild", { status });
      assert.equal(f.summary().pendingWork, true);
    }
    f.storage.conversations.update("grandchild", { status: "idle" });
    f.storage.conversations.update("root", { status: "running" });
    assert.equal(
      f.summary().pendingWork,
      false,
      "own status is not pending work",
    );
  } finally {
    f.storage.close();
  }
});

test("oldest pending input includes the owning child's identity and title", () => {
  const f = fixture();
  try {
    const call = (id: string, conversationId: string, updatedAt: string) =>
      f.storage.toolCalls.insert({
        id,
        conversationId,
        turnId: "turn",
        providerCallId: null,
        assistantEventId: null,
        contentIndex: null,
        origin: "user",
        toolName: "bash",
        arguments: {},
        state: "awaiting_approval",
        supervision: null,
        interaction: null,
        executionClaim: null,
        updatedAt,
      });
    call("older", "grandchild", at);
    call("newer", "root", "2026-10-11T00:00:00.000Z");
    assert.deepEqual(f.summary().pendingInput, {
      conversationId: "grandchild",
      conversationTitle: "grandchild title",
      toolCallId: "older",
      kind: "approval",
    });
    assert.deepEqual(
      f.storage.conversations.list({ projectId: "p" })[0]!.pendingInput,
      f.summary().pendingInput,
    );
    f.storage.toolCalls.update("older", {
      state: "awaiting_input",
      interaction: {
        kind: "user_input",
        request: { questions: [{ id: "question", question: "Continue?" }] },
      },
    });
    assert.equal(f.summary().pendingInput?.kind, "user_input");
    f.storage.toolCalls.delete("older");
    assert.equal(f.summary().pendingInput?.toolCallId, "newer");
    f.storage.toolCalls.delete("newer");
    assert.equal(f.summary().pendingInput, null);
  } finally {
    f.storage.close();
  }
});

test("child status changes publish every ancestor, and completion stays pending until parent report delivery", () => {
  const f = fixture();
  try {
    const status = new StatusService(
      f.storage,
      f.emit,
      () => at,
      (result) => {
        f.inputs.enqueueNotice({
          conversationId: "child",
          inputId: "report",
          subtype: "sub_conversation_event",
          producer: "grandchild",
          text: "Completed",
          details: {
            childConversationId: "grandchild",
            assignmentId: result.executionId,
            status: result.transition,
            assetIds: [],
          },
          wakeWhenIdle: true,
        });
      },
      () => false,
    );
    const started = status.transition("grandchild", {
      subtype: "execution_state",
      transition: "started",
    });
    const summaries = () =>
      f.changes
        .filter((change) => change.kind === "conversation_changed")
        .map((change) => change.summary);
    assert.deepEqual(
      summaries().map((row) => row.id),
      ["grandchild", "child", "root"],
    );
    assert.equal(
      summaries().find((row) => row.id === "root")!.pendingWork,
      true,
    );
    f.changes.length = 0;
    status.transition("grandchild", {
      subtype: "execution_state",
      transition: "completed",
      executionId: started.id,
    });
    assert.ok(
      summaries()
        .filter((row) => row.id === "root")
        .every((row) => row.pendingWork),
      "no false quiet publication before the report is queued",
    );
    assert.equal(f.summary().pendingWork, true);
    f.inputs.deliver("child", { kind: "turn" });
    assert.equal(f.summary().pendingWork, false);
    assert.equal(summaries().at(-1)!.id, "root");
    assert.equal(summaries().at(-1)!.pendingWork, false);
  } finally {
    f.storage.close();
  }
});
