import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { toolCallRecordSchema } from "@nervekit/contracts/tools";
import { CanonicalToolExternalInvoker } from "../../../src/domains/tools/execution/canonical-tool-external-invoker.js";
import { ToolResultPayloadStore } from "../../../src/domains/tools/artifacts/tool-result-payload-store.js";

test("canonical external invocation executes without a durable tool repository", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-tool-invoke-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const calls: unknown[] = [];
  const invoker = new CanonicalToolExternalInvoker(
    {
      async execute(toolCall: unknown, args: unknown) {
        calls.push({ toolCall, args });
        return { content: "hello" };
      },
    } as never,
    new ToolResultPayloadStore(home),
  );
  const result = await invoker.invoke({
    agent: {
      id: "agent_canonical_tool",
      conversationId: "conv_canonical_tool",
      projectId: "proj_canonical_tool",
    } as never,
    effectId: "effect_canonical_tool_1",
    attemptId: "attempt_canonical_tool_1",
    providerToolCallId: "provider-tool-1",
    toolName: "read",
    normalizedArgs: { path: "README.md" },
    cwd: home,
    risk: "read",
    runId: "run_canonical_tool",
  });
  assert.equal(calls.length, 1);
  assert.equal(result.status, "completed");
  assert.equal(result.providerToolCallId, "provider-tool-1");
  assert.equal(result.revision, 2);
  assert.equal(result.settledAt, result.updatedAt);
  assert.equal(toolCallRecordSchema.safeParse(result).success, true);
});

test("canonical external invocation rejects suspending tools", async () => {
  const invoker = new CanonicalToolExternalInvoker(
    { execute: async () => ({}) } as never,
    {} as never,
  );
  await assert.rejects(
    invoker.invoke({
      agent: {
        id: "agent_canonical_tool",
        conversationId: "conv_canonical_tool",
        projectId: "proj_canonical_tool",
      } as never,
      effectId: "effect_canonical_tool_2",
      attemptId: "attempt_canonical_tool_2",
      providerToolCallId: "provider-tool-2",
      toolName: "ask_user",
      normalizedArgs: { question: "Continue?" },
      cwd: "/tmp",
      risk: "interaction",
      runId: "run_canonical_tool",
    }),
    /interaction authority/,
  );
});
