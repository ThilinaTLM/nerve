import assert from "node:assert/strict";
import { test } from "node:test";
import { activeToolNameSchema } from "@nervekit/contracts/tools";
import {
  allToolDescriptors,
  classifyToolRisk,
  describeToolArgumentErrors,
  registerToolDefinitions,
  requireToolDefinition,
} from "../../catalog/index.js";
import { createQuickScriptRegistry } from "../registry.js";
import { createExtensionToolDefinitions } from "./direct-tools.js";
import { demoExtension } from "./test-extension.js";

void test("an extension's direct tool joins the catalog, grouped by its extension", () => {
  const definitions = createExtensionToolDefinitions(
    createQuickScriptRegistry([demoExtension]),
  );
  registerToolDefinitions(definitions);
  // Registering again is a no-op.
  registerToolDefinitions(definitions);

  const descriptor = allToolDescriptors().find(
    (tool) => (tool.name as string) === "demo_item",
  );
  assert.equal(descriptor?.extension, "demo");
  assert.equal(descriptor?.group, "extension");
  assert.equal(descriptor?.baseRisk, "network");
  assert.deepEqual(descriptor?.targetKinds, ["whole_tool"]);
  assert.equal(classifyToolRisk("demo_item"), "network");
  assert.ok(activeToolNameSchema.safeParse("demo_item").success);
  assert.ok(!activeToolNameSchema.safeParse("Not A Name").success);

  // Arguments are validated against the extension's JSON Schema.
  const definition = requireToolDefinition("demo_item");
  assert.equal(describeToolArgumentErrors(definition, { id: "1" }), undefined);
  assert.match(
    describeToolArgumentErrors(definition, {}) ?? "",
    /missing required "id"/,
  );
});

void test("two extensions cannot contribute the same tool name", () => {
  assert.throws(
    () =>
      createQuickScriptRegistry([
        demoExtension,
        {
          ...demoExtension,
          id: "other",
          accounts: {},
          namespaces: [],
          settings: { version: 1, fields: {} },
        },
      ]),
    /Duplicate tool 'demo_item'/,
  );
});
