import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import {
  HumanInputResolutionService,
  type HumanInputResolutionDeps,
} from "../../../src/domains/human-input/human-input-resolution.service.js";

test("resolved and skipped human-input results keep harness tool messages and typed transcript projections", async () => {
  const messages: Array<{
    id: string;
    message: { role: string; toolCallId: string; isError: boolean };
  }> = [];
  const entries: ConversationEntry[] = [];
  const agent = {
    id: "agent_test",
    conversationId: "conv_test",
  } as AgentRecord;
  const service = new HumanInputResolutionService({
    getAgent: () => agent,
    harnessStorage: {
      appendAgentMessage: async (
        _agent: unknown,
        message: (typeof messages)[number]["message"],
      ) => {
        const id = `entry_${messages.length}`;
        messages.push({ id, message });
        return { id, timestamp: "2026-01-01T00:00:00.000Z" };
      },
    },
    appendEntry: async (
      input: ConversationEntry,
      options: { mirrorToHarness?: boolean },
    ) => {
      assert.equal(options.mirrorToHarness, false);
      entries.push(input);
      return input;
    },
  } as unknown as HumanInputResolutionDeps);
  const toolCall = {
    id: "tool_test",
    agentId: agent.id,
    conversationId: agent.conversationId,
    toolName: "ask_user",
    providerToolCallId: "provider_call",
    status: "completed",
    result: { content: "Approved" },
  } as ToolCallRecord;
  await service["appendToolResultForToolCall"](toolCall, false);
  await service["appendSkippedToolResult"](agent.id, {
    id: "provider_skipped",
    name: "read",
  });
  assert.equal(messages.length, 2);
  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["tool_result", "tool_result"],
  );
  assert.deepEqual(
    entries.map((entry) => entry.id),
    messages.map(({ id }) => id),
  );
  assert.deepEqual(
    messages.map(({ message }) => message.role),
    ["toolResult", "toolResult"],
  );
  assert.deepEqual(
    messages.map(({ message }) => message.toolCallId),
    ["provider_call", "provider_skipped"],
  );
  assert.deepEqual(
    messages.map(({ message }) => message.isError),
    [false, true],
  );
  assert.equal(
    (entries[0]?.details as { toolRecordId?: string }).toolRecordId,
    toolCall.id,
  );
});
