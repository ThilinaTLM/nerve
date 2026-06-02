import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toolNameSchema } from "@nerve/shared";
import {
  coreToolDefinitionByName,
  coreToolDefinitions,
  coreToolDescriptors,
} from "@nerve/tools";

describe("agent tool definitions", () => {
  it("covers every shared tool name and derives descriptors from definitions", () => {
    const schemaNames = new Set(toolNameSchema.options);
    const definitionNames = new Set(
      coreToolDefinitions.map((tool) => tool.name),
    );
    const descriptorNames = new Set(
      coreToolDescriptors.map((tool) => tool.name),
    );

    assert.deepEqual(definitionNames, schemaNames);
    assert.deepEqual(descriptorNames, schemaNames);

    for (const definition of coreToolDefinitions) {
      assert.equal(typeof definition.description, "string");
      assert.ok(definition.description.length > 0);
      assert.ok(definition.parameters);
      assert.equal(
        coreToolDescriptors.find((tool) => tool.name === definition.name)
          ?.description,
        definition.description,
      );
    }
  });

  it("normalizes legacy single-edit arguments to the multi-edit schema", () => {
    const edit = coreToolDefinitionByName("edit");
    const prepared = edit.prepareArguments?.({
      path: "src/file.ts",
      oldText: "old",
      newText: "new",
    }) as { path: string; edits: Array<{ oldText: string; newText: string }> };

    assert.deepEqual(prepared, {
      path: "src/file.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
  });
});
