import assert from "node:assert/strict";
import test from "node:test";
import { conversationSummarySchema } from "@nervekit/contracts/core";
import { openCoreStorage } from "../storage/core-storage.js";
import {
  InputQueueService,
  type InputQueueChange,
} from "./input-queue.service.js";

test("user input resumes a paused conversation with a complete summary", () => {
  const storage = openCoreStorage(":memory:");
  try {
    const now = new Date().toISOString();
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
        paused: true,
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
        agentProfile: "coding",

        workingDirectory: "/tmp",
      },
    );
    const changes: InputQueueChange[] = [];
    const wakes: string[] = [];
    const unexpectedProcess = async (): Promise<never> => {
      throw new Error("No process expected");
    };
    const service = new InputQueueService({
      storage,
      processes: {
        start: unexpectedProcess,
        run: unexpectedProcess,
        reattach: unexpectedProcess,
      },
      emit: (change) => changes.push(change),
      requestWake: (id) => wakes.push(id),
    });
    service.submit({
      conversationId: "conv_test",
      inputId: "input_test",
      text: "Hello",
      source: "user",
    });
    const change = changes.find((item) => item.kind === "conversation_changed");
    assert.equal(change?.kind, "conversation_changed");
    if (change?.kind !== "conversation_changed")
      throw new Error("Missing summary");
    const summary = conversationSummarySchema.parse(change.summary);
    assert.equal(summary.paused, false);
    assert.equal(summary.childCount, 0);
    assert.equal(storage.inputs.list("conv_test").length, 1);
    assert.deepEqual(wakes, ["conv_test"]);
    assert.equal(service.hasDeliverable("conv_test", { kind: "turn" }), true);
    const position = storage.conversations.get("conv_test")!.nextInputSequence;
    service.submit({
      conversationId: "conv_test",
      inputId: "input_later",
      text: "Later",
      source: "user",
    });
    // An unfinished earlier preparation still blocks delivery even with a cutoff.
    storage.inputs.update("input_test", {
      preparedText: null,
      commandPreparation: { blocks: [] },
    });
    assert.deepEqual(
      service.deliver(
        "conv_test",
        { kind: "turn" },
        { beforeSequence: position },
      ),
      [],
    );
    storage.inputs.update("input_test", { commandPreparation: null });
    const delivered = service.deliver(
      "conv_test",
      { kind: "turn" },
      { beforeSequence: position },
    );
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].inputId, "input_test");
    assert.deepEqual(
      storage.inputs.list("conv_test").map((row) => row.inputId),
      ["input_later"],
    );
    assert.equal(
      service.deliver("conv_test", { kind: "turn" })[0]?.inputId,
      "input_later",
    );
    assert.equal(storage.inputs.list("conv_test").length, 0);
  } finally {
    storage.close();
  }
});

test("empty queues skip history decoding at both delivery boundaries", () => {
  const storage = openCoreStorage(":memory:");
  try {
    storage.events.since = () => {
      throw new Error("Empty queues must not load transcript history");
    };
    const unexpectedProcess = async (): Promise<never> => {
      throw new Error("No process expected");
    };
    const service = new InputQueueService({
      storage,
      processes: {
        start: unexpectedProcess,
        run: unexpectedProcess,
        reattach: unexpectedProcess,
      },
      emit: () => {
        throw new Error("Empty queues must not emit changes");
      },
      requestWake: () => {
        throw new Error("Empty queues must not wake");
      },
    });
    for (const boundary of [
      { kind: "turn" },
      { kind: "execution_start", executionId: "evt_execution" },
    ] as const) {
      assert.equal(service.hasDeliverable("conv_empty", boundary), false);
      assert.deepEqual(service.deliver("conv_empty", boundary), []);
    }
  } finally {
    storage.close();
  }
});
