import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveConversationTitle } from "@nervekit/shared";
import { summarizeConversations } from "../src/daemon/run-summaries.js";

describe("summarizeConversations", () => {
  it("derives conversation titles from prompts and surfaces mode", () => {
    const prompt = "Please fix the sandbox conversation list not updating";
    const summaries = summarizeConversations([
      {
        conversationId: "conv_1",
        agentId: "agent_main",
        runId: "run_1",
        status: "running",
        prompt,
        mode: "planning",
        createdAt: "2026-06-26T12:00:00.000Z",
        updatedAt: "2026-06-26T12:00:01.000Z",
      },
    ]);

    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.title, deriveConversationTitle(prompt));
    assert.equal(summaries[0]?.mode, "planning");
    assert.deepEqual(summaries[0]?.activeRunIds, ["run_1"]);
  });
});
