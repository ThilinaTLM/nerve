import assert from "node:assert/strict";
import test from "node:test";
import {
  InputQueueService,
  type InputQueueChange,
} from "../inputs/input-queue.service.js";
import { openCoreStorage } from "./core-storage.js";

const at = (day: number) =>
  `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`;

test("child summaries track parent prompt acceptance across queue delivery, not activity", () => {
  const storage = openCoreStorage(":memory:");
  try {
    storage.projects.insert({
      id: "p",
      name: "P",
      directory: "/tmp",
      createdAt: at(1),
      updatedAt: at(1),
    });
    for (const id of ["parent", "child"]) {
      storage.conversations.insert(
        {
          id,
          projectId: "p",
          parentConversationId: id === "child" ? "parent" : null,
          parentToolCallId: null,
          headEventId: null,
          title: id,
          status: "idle",
          statusEventSequence: 0,
          statusClearedAt: null,
          paused: false,
          nextInputSequence: 1,
          pinnedAt: null,
          completedAt: null,
          lastUserMessageAt: null,
          createdAt: at(1),
          updatedAt: at(1),
        },
        {
          conversationId: id,
          model: { provider: "openai", modelId: "gpt-4o-mini" },
          reasoningLevel: "off",
          systemPrompt: null,
          instructions: null,
          permissionRuleSetId: "baseline",
          agentProfile: "coding",
          workingDirectory: "/tmp",
        },
      );
    }
    const summary = () => storage.conversations.getSummary("child")!;
    assert.equal(summary().lastParentPromptAt, null);
    // Historical delivered prompts have no acceptance time; use message time.
    storage.events.append({
      id: "historical",
      conversationId: "child",
      turnId: null,
      inputId: null,
      createdAt: at(2),
      type: "user_message",
      llmRepresentation: "user",
      payload: {
        text: "First assignment",
        originalText: "First assignment",
        source: "parent_conversation",
        senderConversationId: "parent",
        commandPreparation: null,
      },
    });
    assert.equal(summary().lastParentPromptAt, at(2));
    storage.inputs.insert({
      inputId: "follow-up",
      conversationId: "child",
      source: "parent_conversation",
      senderConversationId: "parent",
      content: "Follow-up",
      deliveryTarget: "next_turn",
      targetExecutionId: null,
      commandPreparation: null,
      preparedText: null,
      wakeWhenIdle: true,
      acceptedAt: at(3),
    });
    assert.equal(summary().lastParentPromptAt, at(3));
    const unexpectedProcess = async (): Promise<never> => {
      throw new Error("No process expected");
    };
    const changes: InputQueueChange[] = [];
    const service = new InputQueueService({
      storage,
      processes: {
        start: unexpectedProcess,
        run: unexpectedProcess,
        reattach: unexpectedProcess,
      },
      emit: (change) => changes.push(change),
      requestWake: () => {},
    });
    service.deliver("child", { kind: "turn" });
    assert.equal(storage.inputs.list("child").length, 0);
    assert.equal(summary().lastParentPromptAt, at(3));
    // Neither direct user input nor activity from the child is a parent prompt.
    storage.events.append({
      id: "direct-user",
      conversationId: "child",
      turnId: null,
      inputId: null,
      createdAt: at(4),
      type: "user_message",
      llmRepresentation: "user",
      payload: {
        text: "Direct",
        originalText: "Direct",
        source: "user",
        senderConversationId: null,
        commandPreparation: null,
      },
    });
    storage.conversations.update("child", {
      updatedAt: at(5),
      status: "running",
    });
    assert.equal(summary().lastParentPromptAt, at(3));
    assert.equal(
      storage.conversations.list({
        projectId: "p",
        parentConversationId: "parent",
      })[0]!.lastParentPromptAt,
      at(3),
    );
    assert.equal(
      storage.conversations.getSummary("parent")!.lastParentPromptAt,
      null,
    );
    changes.length = 0;
    const queued = service.submit({
      conversationId: "child",
      inputId: "live-follow-up",
      text: "More work",
      source: "parent_conversation",
      senderConversationId: "parent",
    });
    assert.notEqual(queued, "delivered");
    if (queued === "delivered") throw new Error("Expected queued input");
    const notice = changes.find(
      (change) => change.kind === "conversation_changed",
    );
    assert.equal(notice?.kind, "conversation_changed");
    if (notice?.kind !== "conversation_changed")
      throw new Error("Missing child summary");
    assert.equal(notice.summary.lastParentPromptAt, queued.acceptedAt);
  } finally {
    storage.close();
  }
});
