import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Type } from "typebox";
import { AgentHarness } from "../src/harness/agent-harness.js";
import { Conversation } from "../src/harness/conversation/conversation.js";
import { InMemoryConversationStorage } from "../src/harness/conversation/memory-storage.js";
import {
  registerAgentScriptedProvider,
  resolveAgentModel,
} from "../src/runtime.js";
import {
  AgentToolSuspension,
  isAgentToolSuspension,
} from "../src/suspension.js";
import type { AgentTool } from "../src/types.js";

describe("AgentHarness tool suspensions", () => {
  it("preserves an ordered first-turn sequential batch at the prompt boundary", async () => {
    const provider = "nerve-scripted-harness-suspension";
    const registration = registerAgentScriptedProvider({
      provider,
      steps: [
        {
          type: "toolCalls",
          calls: [
            {
              id: "provider_first",
              name: "bash",
              args: { command: "printf first" },
            },
            {
              id: "provider_second",
              name: "bash",
              args: { command: "printf second" },
            },
            {
              id: "provider_third",
              name: "bash",
              args: { command: "printf third" },
            },
          ],
        },
      ],
    });
    const storage = new InMemoryConversationStorage({
      metadata: {
        id: "conv_suspension_test",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const suspension = new AgentToolSuspension({
      toolCallId: "durable_first",
      toolName: "bash",
      reason: "Approval required",
    });
    const bash: AgentTool = {
      name: "bash",
      label: "bash",
      description: "Test sequential bash",
      parameters: Type.Object({ command: Type.String() }),
      executionMode: "sequential",
      execute: async () => {
        throw suspension;
      },
    };
    const harness = new AgentHarness({
      env: {} as never,
      conversation: new Conversation(storage),
      model: resolveAgentModel({ provider, modelId: "scripted-fast" }),
      systemPrompt: "test",
      tools: [bash],
    });

    try {
      let caught: unknown;
      try {
        await harness.prompt("Run three commands.");
      } catch (error) {
        caught = error;
      }

      assert.ok(isAgentToolSuspension(caught));
      assert.equal(caught.data.toolCallId, "durable_first");
      assert.equal(caught.data.toolCall?.id, "provider_first");
      assert.deepEqual(
        caught.data.remainingToolCalls?.map((call) => ({
          id: call.id,
          name: call.name,
          arguments: call.arguments,
        })),
        [
          {
            id: "provider_second",
            name: "bash",
            arguments: { command: "printf second" },
          },
          {
            id: "provider_third",
            name: "bash",
            arguments: { command: "printf third" },
          },
        ],
      );

      const assistantMessages = (await storage.getEntries()).filter(
        (entry) =>
          entry.type === "message" && entry.message.role === "assistant",
      );
      assert.equal(assistantMessages.length, 1);
      const assistantEntry = assistantMessages[0];
      assert.equal(assistantEntry?.type, "message");
      if (assistantEntry?.type === "message") {
        assert.equal(assistantEntry.message.role, "assistant");
        if (assistantEntry.message.role === "assistant") {
          assert.notEqual(assistantEntry.message.stopReason, "error");
          assert.equal(assistantEntry.message.errorMessage, undefined);
        }
      }
    } finally {
      registration.unregister();
    }
  });
});
