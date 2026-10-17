import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionStatePayload } from "@nervekit/contracts/core";
import { openCoreStorage } from "../storage/core-storage.js";
import { latestExecution, openExecutionId, StatusService } from "./status.js";

const now = "2026-10-10T00:00:00.000Z";
function fixture() {
  const storage = openCoreStorage(":memory:");
  storage.projects.insert({
    id: "proj_test",
    name: "Test",
    directory: "/tmp",
    createdAt: now,
    updatedAt: now,
  });
  storage.conversations.insert(
    {
      id: "conv_test",
      projectId: "proj_test",
      parentConversationId: null,
      parentToolCallId: null,
      headEventId: null,
      title: "Test",
      status: "idle",
      statusEventSequence: 0,
      statusClearedAt: null,
      paused: false,
      nextInputSequence: 1,
      pinnedAt: null,
      completedAt: null,
      lastUserMessageAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      conversationId: "conv_test",
      model: { provider: "openai", modelId: "gpt-4o-mini" },
      reasoningLevel: "off",
      systemPrompt: null,
      instructions: null,
      permissionRuleSetId: "baseline",
      mode: "coding",
      workingDirectory: "/tmp",
    },
  );
  let count = 0;
  const append = (payload: ExecutionStatePayload, createdAt = now) =>
    storage.events.append({
      id: `evt_${++count}`,
      conversationId: "conv_test",
      type: "system_event",
      llmRepresentation: "none",
      turnId: null,
      inputId: null,
      payload,
      createdAt,
    });
  return { storage, append };
}

test("latest execution follows append sequence across branches, not timestamps or head", () => {
  const { storage, append } = fixture();
  try {
    assert.equal(latestExecution(storage, "conv_test"), undefined);
    assert.equal(storage.events.lastSequence("conv_test"), 0);
    const started = append({
      subtype: "execution_state",
      transition: "started",
    });
    const failed = append(
      {
        subtype: "execution_state",
        transition: "failed",
        executionId: started.id,
        failure: { message: "failed" },
      },
      "2026-10-09T00:00:00.000Z",
    );
    storage.conversations.update("conv_test", { headEventId: started.id });
    storage.events.append({
      id: "evt_other",
      conversationId: "conv_test",
      type: "user_message",
      llmRepresentation: "user",
      turnId: null,
      inputId: null,
      createdAt: now,
      payload: {
        text: "later non-execution",
        originalText: "later non-execution",
        acceptedAt: now,
        source: "user",
        senderConversationId: null,
        commandPreparation: null,
      },
    });
    assert.deepEqual(latestExecution(storage, "conv_test"), failed);
    assert.equal(openExecutionId(storage, "conv_test"), null);
    assert.equal(storage.events.lastSequence("conv_test"), 3);
    assert.equal(latestExecution(storage, "missing"), undefined);
  } finally {
    storage.close();
  }
});

test("refresh reuses one execution lookup without decoding history and preserves status semantics", () => {
  const { storage, append } = fixture();
  try {
    let changes = 0;
    let lookups = 0;
    const query = storage.events.latestExecution.bind(storage.events);
    storage.events.latestExecution = (id) => {
      lookups++;
      return query(id);
    };
    storage.events.since = () => {
      throw new Error("must not decode history");
    };
    const service = new StatusService(
      storage,
      () => {
        changes++;
      },
      () => now,
      () => {},
    );
    const refresh = (expected: string) => {
      lookups = 0;
      service.refresh("conv_test");
      assert.equal(lookups, 1);
      assert.equal(storage.conversations.get("conv_test")?.status, expected);
      assert.equal(
        storage.conversations.get("conv_test")?.statusEventSequence,
        storage.events.lastSequence("conv_test"),
      );
    };
    refresh("idle");
    assert.equal(changes, 0);
    const started = append({
      subtype: "execution_state",
      transition: "started",
    });
    assert.equal(openExecutionId(storage, "conv_test"), started.id);
    refresh("running");
    for (const transition of ["waiting", "retrying"] as const) {
      append({
        subtype: "execution_state",
        transition,
        executionId: started.id,
        ...(transition === "retrying"
          ? {
              retry: {
                attempt: 1,
                maxAttempts: 3,
                delayMs: 100,
                error: "retry",
              },
            }
          : {}),
      });
      assert.equal(openExecutionId(storage, "conv_test"), started.id);
      refresh("running");
    }
    for (const transition of [
      "completed",
      "cancelled",
      "failed",
      "interrupted",
    ] as const) {
      append({
        subtype: "execution_state",
        transition,
        executionId: started.id,
        ...(transition === "failed" ? { failure: { message: "failed" } } : {}),
      });
      assert.equal(openExecutionId(storage, "conv_test"), null);
      refresh(
        transition === "failed" || transition === "interrupted"
          ? transition
          : "idle",
      );
    }
    storage.conversations.update("conv_test", { statusClearedAt: now });
    refresh("idle");
    const previous = changes;
    refresh("idle");
    assert.equal(changes, previous);
    append(
      {
        subtype: "execution_state",
        transition: "failed",
        executionId: started.id,
        failure: { message: "new failure" },
      },
      "2026-10-11T00:00:00.000Z",
    );
    refresh("failed");
    storage.toolCalls.list = () =>
      [{ state: "awaiting_approval" }] as ReturnType<
        typeof storage.toolCalls.list
      >;
    refresh("waiting");
    storage.toolCalls.list = () =>
      [{ state: "awaiting_input" }] as ReturnType<
        typeof storage.toolCalls.list
      >;
    refresh("waiting");
    storage.toolCalls.list = () =>
      [{ state: "running" }] as ReturnType<typeof storage.toolCalls.list>;
    refresh("running");
  } finally {
    storage.close();
  }
});
