import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import type { RunRecord } from "@nervekit/contracts/runs";
import type { ConversationTreeEntry } from "@nervekit/harness/conversation";
import {
  checkpointTranscriptEntryIds,
  isAuthorizedTaskEventAdvance,
} from "../../../src/domains/runs/application/run-references.js";

const run: RunRecord = {
  stateEpoch: 1,
  conversationId: "conv_a",
  agentId: "agent_a",
  projectId: "proj_a",
  runId: "run_a",
  scopeId: "conv_a:agent_a",
  revision: 2,
  status: "interrupted",
  recoverability: "checkpoint",
  executionId: "exec_a",
  attempt: 1,
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:01.000Z",
  cancellationEvidence: [],
};

function checkpointEntry(id = "entry_checkpoint"): ConversationTreeEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: run.createdAt,
    message: { role: "user", content: "hello", timestamp: 0 },
  };
}

function taskEntry(
  id: string,
  parentId: string,
  notificationEntryId: string,
): ConversationTreeEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: run.updatedAt,
    message: {
      role: "harness",
      eventType: "task_event",
      content: "Task completed",
      details: { notificationEntryId },
      timestamp: 1,
    },
  };
}

function projection(id: string, runId = run.runId): ConversationEntry {
  return {
    id,
    conversationId: run.conversationId,
    agentId: run.agentId,
    runId,
    role: "system",
    kind: "task_event",
    text: "Task completed",
    details: {
      type: "task_event",
      source: "harness",
      notificationEntryId: id,
    },
    createdAt: run.updatedAt,
  };
}

test("excludes run-status projections from checkpoint transcript references", () => {
  const message: ConversationEntry = {
    id: "entry_message",
    conversationId: run.conversationId,
    agentId: run.agentId,
    runId: run.runId,
    role: "assistant",
    kind: "message",
    text: "answer",
    createdAt: run.createdAt,
  };
  const status: ConversationEntry = {
    ...message,
    id: "entry_status",
    role: "system",
    kind: "run_status",
  };

  assert.deepEqual(
    checkpointTranscriptEntryIds([{ entries: [message, status] }]),
    [message.id],
  );
});

test("authorizes only a descendant chain of projected harness task events", () => {
  const projected = new Map([
    ["entry_notice_a", projection("entry_notice_a")],
    ["entry_notice_b", projection("entry_notice_b")],
  ]);
  const path = [
    checkpointEntry(),
    taskEntry("entry_task_a", "entry_checkpoint", "entry_notice_a"),
    taskEntry("entry_task_b", "entry_task_a", "entry_notice_b"),
  ];

  assert.equal(
    isAuthorizedTaskEventAdvance(path, "entry_checkpoint", run, (id) =>
      projected.get(id),
    ),
    true,
  );
});

test("rejects an unrelated branch or untyped harness descendant", () => {
  const projected = projection("entry_notice");
  const untypedHarness = taskEntry(
    "entry_task",
    "entry_checkpoint",
    "entry_notice",
  );
  if (untypedHarness.type === "message") {
    untypedHarness.message = {
      role: "harness",
      eventType: "other_event",
      content: "not a task event",
      timestamp: 1,
    };
  }

  assert.equal(
    isAuthorizedTaskEventAdvance(
      [checkpointEntry(), untypedHarness],
      "entry_other_branch",
      run,
      () => projected,
    ),
    false,
  );
  assert.equal(
    isAuthorizedTaskEventAdvance(
      [checkpointEntry(), untypedHarness],
      "entry_checkpoint",
      run,
      () => projected,
    ),
    false,
  );
});

test("rejects task projections owned by another run", () => {
  const path = [
    checkpointEntry(),
    taskEntry("entry_task", "entry_checkpoint", "entry_notice"),
  ];

  assert.equal(
    isAuthorizedTaskEventAdvance(path, "entry_checkpoint", run, () =>
      projection("entry_notice", "run_other"),
    ),
    false,
  );
});
