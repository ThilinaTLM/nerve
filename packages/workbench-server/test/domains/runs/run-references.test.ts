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
    checkpointTranscriptEntryIds(
      [{ entries: [message, status] }],
      [checkpointEntry(message.id), checkpointEntry(status.id)],
    ),
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

test("authorizes typed and legacy subagent notifications but never run-status projections", () => {
  const path = [
    checkpointEntry(),
    {
      ...taskEntry("entry_child", "entry_checkpoint", "entry_notice"),
      message: {
        role: "harness" as const,
        eventType: "subagent_event",
        content: "Child completed",
        details: { notificationEntryId: "entry_notice" },
        timestamp: 1,
      },
    },
  ];
  const typed = {
    ...projection("entry_notice"),
    kind: "subagent_run_event" as const,
    details: {
      type: "subagent_event",
      source: "harness",
      notificationEntryId: "entry_notice",
    },
  };
  for (const kind of ["subagent_run_event", "message"] as const) {
    assert.equal(
      isAuthorizedTaskEventAdvance(path, "entry_checkpoint", run, () => ({
        ...typed,
        kind,
      })),
      true,
    );
  }
  assert.equal(
    isAuthorizedTaskEventAdvance(path, "entry_checkpoint", run, () => ({
      ...typed,
      kind: "run_status",
    })),
    false,
  );
  assert.deepEqual(
    checkpointTranscriptEntryIds(
      [
        {
          entries: [
            typed,
            { ...typed, kind: "run_status", id: "entry_status" },
          ],
        },
      ],
      path,
    ),
    [typed.id],
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

test("checkpoint references follow branch order without abandoning durable history", () => {
  const prompt = { ...projection("prompt"), kind: "message" as const };
  const error = {
    ...prompt,
    id: "provider_error",
    details: { stopReason: "error", errorMessage: "overloaded" },
  };
  const retry = { ...prompt, id: "retry" };
  const transitions = [
    { entries: [error, prompt] },
    { entries: [retry, prompt] },
  ];
  assert.deepEqual(
    checkpointTranscriptEntryIds(transitions, [
      checkpointEntry(prompt.id),
      checkpointEntry(retry.id),
    ]),
    [prompt.id, retry.id],
  );
  assert.deepEqual(
    checkpointTranscriptEntryIds(transitions, [
      checkpointEntry(prompt.id),
      checkpointEntry(error.id),
    ]),
    [prompt.id, error.id],
  );
  assert.equal(transitions[0].entries[0], error);
  assert.deepEqual(checkpointTranscriptEntryIds(transitions, []), []);
});

test("checkpoint references map notifications and exclude unrelated and metadata nodes", () => {
  const task = projection("task_projection");
  const child = {
    ...projection("child_projection"),
    kind: "subagent_run_event" as const,
  };
  const taskNode = taskEntry("task_harness", "old_run", task.id);
  const childNode = taskEntry("child_harness", taskNode.id, child.id);
  if (childNode.type === "message" && childNode.message.role === "harness") {
    childNode.message.eventType = "subagent_event";
  }
  const config: ConversationTreeEntry = {
    type: "model_change",
    id: "config",
    parentId: childNode.id,
    timestamp: run.updatedAt,
    provider: "test",
    modelId: "test",
  };
  assert.deepEqual(
    checkpointTranscriptEntryIds(
      [
        {
          entries: [child, task, { ...projection(config.id), kind: "message" }],
        },
      ],
      [checkpointEntry("old_run"), taskNode, childNode, config, taskNode],
    ),
    [task.id, child.id],
  );
});
