import assert from "node:assert/strict";
import { it } from "node:test";
import { Check } from "typebox/value";
import { createSubagentHandlers } from "../../src/runtime/orchestration/subagents.js";
import { subagentToolDefinitions } from "../../src/catalog/definitions/orchestration/subagent.tools.js";

const schemaOf = (tool: string) =>
  subagentToolDefinitions.find((item) => item.name === tool)!.parameters;

it("rejects malformed batches before backend side effects", async () => {
  const handlers = createSubagentHandlers(async () => {
    assert.fail("invalid sub-agent calls must not reach the backend");
  });
  for (const args of [
    {},
    { assignments: [] },
    { assignments: [{ name: "a" }] },
    { assignments: [{ name: " ", prompt: "x" }] },
  ]) {
    await assert.rejects(handlers.subagent_prompt!(args, {} as never));
  }
  await assert.rejects(handlers.subagent_stop!({ names: [] }, {} as never));
  await assert.rejects(handlers.subagent_stop!({}, {} as never));
});

it("forwards valid calls to the host port", async () => {
  const calls: string[] = [];
  const handlers = createSubagentHandlers(async (name) => {
    calls.push(name);
    return { content: "ok" };
  });
  await handlers.subagent_prompt!(
    { assignments: [{ name: "a", profile: "explore", prompt: "x" }] },
    {} as never,
  );
  await handlers.subagent_status!({}, {} as never);
  await handlers.subagent_stop!({ names: ["a"] }, {} as never);
  assert.deepEqual(calls, [
    "subagent_prompt",
    "subagent_status",
    "subagent_stop",
  ]);
});

it("exposes the batch, status and stop parameter shapes", () => {
  assert.deepEqual(
    subagentToolDefinitions.map((item) => item.name),
    ["subagent_prompt", "subagent_status", "subagent_stop"],
  );
  const prompt = schemaOf("subagent_prompt");
  const one = { name: "a", prompt: "x" };
  assert.equal(Check(prompt, { assignments: [one] }), true);
  assert.equal(
    Check(prompt, {
      context: "c",
      assignments: [{ ...one, profile: "explore" }],
    }),
    true,
  );
  assert.equal(Check(prompt, { assignments: [] }), false);
  assert.equal(Check(prompt, { assignments: Array(11).fill(one) }), false);
  assert.equal(Check(prompt, { assignments: [{ ...one, name: "" }] }), false);
  assert.equal(
    Check(prompt, { assignments: [{ ...one, name: "a".repeat(81) }] }),
    false,
  );
  assert.equal(
    Check(prompt, { assignments: [{ ...one, resume: true }] }),
    false,
  );
  assert.equal(Check(schemaOf("subagent_status"), {}), true);
  assert.equal(Check(schemaOf("subagent_status"), { name: "a" }), true);
  assert.equal(Check(schemaOf("subagent_stop"), { names: ["a"] }), true);
  assert.equal(Check(schemaOf("subagent_stop"), { names: [] }), false);
  assert.equal(Check(schemaOf("subagent_stop"), { name: "a" }), false);
});
