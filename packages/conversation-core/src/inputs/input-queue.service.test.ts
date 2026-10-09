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
        permissionRuleSetId: "baseline",
        mode: "coding",
        enabledTools: null,
        enabledSkills: [],
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
  } finally {
    storage.close();
  }
});
