import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Type } from "typebox";
import { AgentToolSuspension } from "../src/suspension.js";
import { createAgentToolsFromDefinitions } from "../src/tool-adapter.js";

describe("definition-to-AgentTool adapter", () => {
  const definitions = [
    {
      name: "one",
      label: "One",
      description: "First tool",
      parameters: Type.Object({ value: Type.String() }),
      executionMode: "parallel" as const,
    },
    {
      name: "two",
      label: "Two",
      description: "Second tool",
      parameters: Type.Object({}),
    },
  ];

  it("filters, maps fields, and forwards execution signal and updates", async () => {
    const controller = new AbortController();
    const adapterUpdates: unknown[] = [];
    const callerUpdates: unknown[] = [];
    const calls: unknown[] = [];
    const tools = createAgentToolsFromDefinitions(
      definitions,
      new Set(["one"]),
      async (definition, sourceId, params, signal, onUpdate) => {
        calls.push({ name: definition.name, sourceId, params, signal });
        onUpdate?.({
          content: [{ type: "text", text: "partial" }],
          details: {},
        });
        return { content: [{ type: "text", text: "done" }], details: params };
      },
      { onOutputUpdate: (_name, _id, update) => adapterUpdates.push(update) },
    );
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.label, "One");
    assert.equal(tools[0]?.executionMode, "parallel");
    const result = await tools[0]?.execute(
      "call_1",
      { value: "ok" },
      controller.signal,
      (update) => callerUpdates.push(update),
    );
    assert.deepEqual(result?.content, [{ type: "text", text: "done" }]);
    assert.deepEqual(calls, [
      {
        name: "one",
        sourceId: "call_1",
        params: { value: "ok" },
        signal: controller.signal,
      },
    ]);
    assert.equal(adapterUpdates.length, 1);
    assert.equal(callerUpdates.length, 1);
  });

  it("passes host errors and suspensions through unchanged", async () => {
    const suspension = new AgentToolSuspension({
      toolCallId: "tool_1",
      toolName: "one",
      reason: "wait",
    });
    const [tool] = createAgentToolsFromDefinitions(
      definitions,
      new Set(["one"]),
      async () => {
        throw suspension;
      },
    );
    await assert.rejects(
      tool?.execute("call_1", { value: "ok" }),
      (error) => error === suspension,
    );
  });
});
