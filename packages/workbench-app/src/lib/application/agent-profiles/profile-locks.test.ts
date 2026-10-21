import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentProfile } from "@nervekit/contracts/agent-profiles";
import { compactionLocked, lockedFieldsOf } from "./profile-locks";

const profile = {
  model: "inherit",
  thinking: { lock: "default" },
  permission: { lock: "planning" },
  compaction: "default",
} as AgentProfile;

test("only Lock scalars disable pickers", () => {
  assert.deepEqual(lockedFieldsOf(profile), {
    model: false,
    thinking: true,
    permission: true,
  });
  assert.equal(compactionLocked(profile), false);
  assert.equal(
    compactionLocked({ ...profile, compaction: { lock: "default" } }),
    true,
  );
  assert.deepEqual(lockedFieldsOf(undefined), {});
});
