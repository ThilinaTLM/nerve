import { test } from "node:test";
import assert from "node:assert/strict";
import { convertDocument } from "./documents.js";
const rule = {
  id: "plan",
  enabled: true,
  priority: 0,
  enforcement: "overridable",
  when: { toolNames: ["plan_mode_present"] },
  decision: "deny",
  description: "plan_mode_present is prose",
};
await test("registered policy conversion renames only selectors and removes validated released compatibility metadata", () => {
  const before = {
    schemaVersion: 1,
    id: "custom",
    name: "Custom",
    source: "user",
    enabled: true,
    compatibleModes: ["planning"],
    rules: [rule],
  };
  const after = convertDocument(before, "rule-set") as typeof before;
  assert(!Object.hasOwn(after, "compatibleModes"));
  assert.deepEqual(after.rules[0].when.toolNames, ["plan_present"]);
  assert.equal(after.rules[0].description, rule.description);
  assert.deepEqual(before.rules[0].when.toolNames, ["plan_mode_present"]);
  const overlay = {
    schemaVersion: 2,
    overlays: [{ ruleSetId: "custom", rules: [rule] }],
  };
  const changed = convertDocument(overlay, "permissions") as typeof overlay;
  assert.deepEqual(changed.overlays[0].rules[0].when.toolNames, [
    "plan_present",
  ]);
});
await test("invalid and unsupported policy documents are preserved for their owning health loader, not silently repaired", () => {
  const invalids = [
    null,
    { schemaVersion: 3, overlays: [rule] },
    {
      schemaVersion: 2,
      overlays: [{ ruleSetId: "custom", rules: [{ ...rule, unknown: true }] }],
    },
    {
      schemaVersion: 1,
      id: "custom",
      name: "Custom",
      source: "user",
      enabled: true,
      compatibleModes: [null],
      rules: [rule],
    },
  ];
  for (const before of invalids)
    assert.deepEqual(
      convertDocument(
        before,
        before?.schemaVersion === 1 ? "rule-set" : "permissions",
      ),
      before,
    );
});
