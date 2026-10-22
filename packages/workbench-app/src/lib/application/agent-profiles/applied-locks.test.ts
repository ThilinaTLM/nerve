import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppliedAgentProfile } from "@nervekit/contracts/agent-profiles";
import { hasLocks, lockedFieldsOf } from "./applied-locks";

const applied: AppliedAgentProfile = {
  schemaVersion: 1,
  name: "planning",
  instructions: "",
  locked: {
    permission: "planning",
    tools: { plan_present: { enabled: true } },
  },
};

test("locks come from the applied snapshot", () => {
  assert.deepEqual(lockedFieldsOf(applied), {
    by: "planning",
    model: false,
    thinking: false,
    permission: true,
    compaction: false,
    skills: false,
    tools: ["plan_present"],
  });
  assert.equal(hasLocks(lockedFieldsOf(applied)), true);
});

test("no applied profile or no locks leaves everything editable", () => {
  assert.deepEqual(lockedFieldsOf(null), {});
  assert.equal(hasLocks(lockedFieldsOf({ ...applied, locked: {} })), false);
});
