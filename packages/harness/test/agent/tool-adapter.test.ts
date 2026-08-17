import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Type } from "typebox";
import { createAgentToolsFromDefinitions } from "../../src/agent/tool-adapter.js";

describe("agent tool adapter", () => {
  it("passes the canonical object-root schema through unchanged", () => {
    const parameters = Type.Object(
      { value: Type.Optional(Type.String()) },
      { additionalProperties: false },
    );
    const [tool] = createAgentToolsFromDefinitions(
      [
        {
          name: "example_tool",
          label: "Example tool",
          description: "Example",
          parameters,
        },
      ],
      undefined,
      async () => ({ content: [], details: {} }),
    );

    assert.ok(tool);
    assert.strictEqual(tool.parameters, parameters);
    assert.equal(tool.parameters.type, "object");
  });
});
