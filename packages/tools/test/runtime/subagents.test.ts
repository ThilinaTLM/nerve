import assert from "node:assert/strict";
import { it } from "node:test";
import { subagentToolDefinitions } from "../../src/catalog/definitions/orchestration/subagent.tools.js";
import { createSubagentHandlers } from "../../src/runtime/orchestration/subagents.js";

it("accepts teammate names, not agent IDs, for every control tool", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const handlers = createSubagentHandlers(async (_tool, args) => {
    calls.push(args);
    return { content: "ok" };
  });
  for (const tool of [
    "subagent_prompt",
    "subagent_status",
    "subagent_stop",
  ] as const) {
    const definition = subagentToolDefinitions.find(
      (item) => item.name === tool,
    )!;
    assert.deepEqual(
      Object.keys(definition.parameters.properties).sort(),
      tool === "subagent_prompt" ? ["name", "prompt"] : ["name"],
    );
    const args = {
      name: "Researcher",
      ...(tool === "subagent_prompt" ? { prompt: "work" } : {}),
    };
    await handlers[tool]!(args, {} as never);
    await assert.rejects(
      handlers[tool]!(
        {
          id: "agent_child",
          ...(tool === "subagent_prompt" ? { prompt: "work" } : {}),
        },
        {} as never,
      ),
      /name/,
    );
  }
  assert.equal(calls.length, 3);
});
