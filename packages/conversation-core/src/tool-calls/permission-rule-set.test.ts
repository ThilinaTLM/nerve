import assert from "node:assert/strict";
import test from "node:test";
import { effectivePermissionRuleSetId } from "./permission-rule-set.js";

void test("permission uses the active profile lock, otherwise the stored rule set", () => {
  const config = { permissionRuleSetId: "autonomous" };
  assert.equal(effectivePermissionRuleSetId(config), "autonomous");
  assert.equal(
    effectivePermissionRuleSetId(config, { permissionRuleSetId: "planning" }),
    "planning",
  );
  assert.equal(effectivePermissionRuleSetId(config, {}), "autonomous");
  assert.deepEqual(config, { permissionRuleSetId: "autonomous" });
});
