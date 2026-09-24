import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import type { RunExecutionSink } from "../../../src/domains/runs/runtime/index.js";
import type { WorkbenchAgentMechanicsDeps } from "../../../src/domains/agents/execution/workbench-agent-mechanics.js";
import { InlineCommandRunner } from "../../../src/domains/agents/execution/inline-command-runner.js";

test("inline command retains its harness bash execution while projecting a typed entry once", async () => {
  const agent = {
    id: "agent_test",
    conversationId: "conv_test",
  } as AgentRecord;
  const toolCall = {
    id: "tool_test",
    toolName: "bash",
    args: { command: "echo hello" },
    status: "completed",
    result: { content: "hello", details: { exitCode: 0 } },
  } as ToolCallRecord;
  const harness: unknown[] = [];
  const appended: ConversationEntry[] = [];
  const sinkEntries: ConversationEntry[][] = [];
  const runner = new InlineCommandRunner({
    tools: { requestToolAndWait: async () => toolCall },
    harnessStorage: {
      appendAgentMessageWithId: async (
        _agent: unknown,
        id: string,
        message: unknown,
      ) => {
        harness.push({ id, message });
      },
    },
    appendEntry: async (input: ConversationEntry, options: unknown) => {
      assert.deepEqual(options, { mirrorToHarness: false });
      appended.push(input);
      return input;
    },
  } as unknown as WorkbenchAgentMechanicsDeps);
  const sink = {
    upsertToolCalls: async () => {},
    appendEntries: async (entries: ConversationEntry[]) => {
      sinkEntries.push(entries);
    },
  } as unknown as RunExecutionSink;

  const outcome = await runner.runCoordinatorPrompt({
    agent,
    command: "echo hello",
    runId: "run_test",
    sink,
    signal: new AbortController().signal,
  });
  assert.equal(outcome.status, "completed");
  assert.equal(appended.length, 1);
  assert.equal(appended[0]?.kind, "inline_command_result");
  assert.equal(appended[0]?.role, "system");
  assert.equal(
    (appended[0]?.details as { type?: string }).type,
    "inline_command_result",
  );
  assert.deepEqual(sinkEntries, [appended]);
  assert.equal(harness.length, 1);
  assert.deepEqual((harness[0] as { id: string }).id, appended[0]?.id);
  const message = (
    harness[0] as { message: { role: string; command: string; output: string } }
  ).message;
  assert.equal(message.role, "bashExecution");
  assert.equal(message.command, "echo hello");
  assert.match(message.output, /hello/);
});
