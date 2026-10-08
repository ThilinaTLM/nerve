import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentInputPreparation,
  AgentInputRecord,
  AgentRecord,
} from "@nervekit/contracts/agents";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import { prepareAgentInputCommands } from "../../../src/domains/agents/execution/agent-input-preparation.js";

type Options = Parameters<typeof prepareAgentInputCommands>[0];
function fixture() {
  let saved: { data: unknown; revision: number } | undefined;
  const input = {
    id: "input_one",
    agentId: "agent_one",
    conversationId: "conv_one",
    text: "Before\n```!!!\nprintf first\n```\nBetween\n```!!!\nprintf second\n```\nAfter",
    role: "user",
    origin: { kind: "user", userId: "u" },
  } as AgentInputRecord;
  const actor = {
    id: input.agentId,
    projectDir: "/tmp",
    configurationRevision: 1,
    permissionLevel: "autonomous",
  } as AgentRecord;
  const calls: string[] = [];
  const result = (command: string) =>
    ({
      id: `tool_${calls.length}`,
      agentId: input.agentId,
      conversationId: input.conversationId,
      providerToolCallId: `input-block:${input.id}:${calls.length - 1}`,
      toolName: "bash",
      args: { command },
      status: "completed",
      result: { content: `${command} output`, details: { exitCode: 0 } },
    }) as ToolCallRecord;
  const options: Options = {
    input,
    actor,
    runId: "run_one",
    attemptId: "attempt_one",
    signal: new AbortController().signal,
    storage: {
      canonicalStore: {
        readDocument: async () => structuredClone(saved),
        writeDocument: async (document: {
          data: unknown;
          expectedRevision: number;
        }) => {
          assert.equal(document.expectedRevision, saved?.revision ?? 0);
          saved = {
            data: structuredClone(document.data),
            revision: document.expectedRevision + 1,
          };
        },
      },
    } as unknown as Options["storage"],
    execute: async (command) => {
      calls.push(command);
      return result(command);
    },
    recover: () => undefined,
  };
  return { options, calls, result, saved: () => saved };
}

test("queued block results replace source in order and survive preparation/insertion retries", async () => {
  const { options, calls } = fixture();
  const expanded = await prepareAgentInputCommands(options);
  assert.deepEqual(calls, ["printf first", "printf second"]);
  assert.match(expanded, /Before/);
  assert.match(expanded, /printf first output/);
  assert.match(expanded, /Between/);
  assert.match(expanded, /printf second output/);
  assert.match(expanded, /After/);
  assert.doesNotMatch(expanded, /```!!!/);
  options.actor.configurationRevision = 2;
  options.attemptId = "replacement";
  assert.equal(await prepareAgentInputCommands(options), expanded);
  assert.equal(
    calls.length,
    2,
    "completed shell work must not repeat on snapshot/insertion retries",
  );
});

test("unknown command outcome is retained and later blocks are not automatically executed", async () => {
  const { options, calls } = fixture();
  options.execute = async (command) => {
    calls.push(command);
    throw new Error("daemon lost result");
  };
  const expanded = await prepareAgentInputCommands(options);
  assert.match(expanded, /status: indeterminate/);
  assert.match(expanded, /status: not_run/);
  assert.equal(await prepareAgentInputCommands(options), expanded);
  assert.equal(calls.length, 1);
});

test("read-only input cannot launch shell blocks, and quoted system-origin data is not executable", async () => {
  const { options, calls } = fixture();
  options.actor.readOnlyCeiling = true;
  await assert.rejects(prepareAgentInputCommands(options), /Read-only/);
  assert.equal(calls.length, 0);
  options.input.origin = {
    kind: "system",
    producer: "task_notification",
    correlationId: "task_one",
  };
  assert.equal(await prepareAgentInputCommands(options), options.input.text);
  assert.equal(calls.length, 0);
});

test("turn interruption preserves earlier results and skips unstarted blocks", async () => {
  const { options, calls, result } = fixture();
  const controller = new AbortController();
  options.signal = controller.signal;
  options.execute = async (command) => {
    calls.push(command);
    controller.abort();
    return result(command);
  };
  const expanded = await prepareAgentInputCommands(options);
  assert.match(expanded, /printf first output/);
  assert.match(expanded, /status: not_run/);
  assert.equal(calls.length, 1);
  assert.equal(
    await prepareAgentInputCommands({
      ...options,
      signal: new AbortController().signal,
    }),
    expanded,
  );
  assert.equal(calls.length, 1);
});

test("crash after tool settlement reuses its durable receipt without executing again", async () => {
  const { options, calls, saved, result } = fixture();
  const expanded = await prepareAgentInputCommands(options);
  const document = saved()!.data as AgentInputPreparation;
  const first = document.blocks[0]!;
  first.state = "running";
  delete first.resultText;
  options.recover = (executionId) => ({
    ...result("printf first"),
    providerToolCallId: executionId,
  });
  assert.equal(
    await prepareAgentInputCommands({ ...options, attemptId: "replacement" }),
    expanded,
  );
  assert.equal(calls.length, 2);
});

test("corrupt block identity is rejected instead of borrowing another input's result", async () => {
  const { options, saved, calls } = fixture();
  await prepareAgentInputCommands(options);
  (saved()!.data as AgentInputPreparation).inputId = "input_foreign";
  await assert.rejects(prepareAgentInputCommands(options), /identity|match/);
  assert.equal(calls.length, 2);
});
