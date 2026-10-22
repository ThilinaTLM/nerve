import assert from "node:assert/strict";
import test from "node:test";
import { effectivePermissionRuleSetId } from "./permission-rule-set.js";

void test("permissions use the persisted materialized rule set, independent of profile name", () => {
  assert.equal(
    effectivePermissionRuleSetId({ permissionRuleSetId: "autonomous" }),
    "autonomous",
  );
  assert.equal(
    effectivePermissionRuleSetId({ permissionRuleSetId: "planning" }),
    "planning",
  );
});
