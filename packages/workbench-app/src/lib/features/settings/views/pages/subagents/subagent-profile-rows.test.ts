import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SubagentProfile } from "@nervekit/contracts/subagents";
import { profileRowState, profileSummary } from "./subagent-profile-rows";

const base: SubagentProfile = {
  name: "scout",
  label: "Scout",
  description: "Scouts.",
  enabled: true,
  source: "user",
  model: "lead",
  thinking: "lead",
  permission: "read_only",
  compaction: "inherit",
  tools: {},
  skills: "none",
  instructions: "",
};
const builtIns = new Set(["explore", "developer"]);

describe("profile rows", () => {
  it("offers every action on an effective profile in its own scope", () => {
    assert.deepEqual(profileRowState(base, "user", builtIns), {
      sourceLabel: "User",
      canEdit: true,
      canDuplicate: true,
      canEnable: true,
      canTrust: false,
      remove: "delete",
    });
  });

  it("resets an override of a built-in instead of deleting it", () => {
    const row = profileRowState({ ...base, name: "explore" }, "user", builtIns);
    assert.equal(row.remove, "reset");
  });

  it("does not remove profiles from another scope", () => {
    const builtin = { ...base, source: "builtin" as const };
    assert.equal(profileRowState(builtin, "user", builtIns).remove, undefined);
    assert.equal(profileRowState(base, "project", builtIns).remove, undefined);
  });

  it("offers Trust, not the switch, for an untrusted project profile", () => {
    const row = profileRowState(
      { ...base, source: "project", trust: "untrusted" },
      "project",
      builtIns,
    );
    assert.equal(row.canTrust, true);
    assert.equal(row.canEnable, false);
    assert.equal(row.remove, "delete");
  });

  it("leaves shadowed profiles inert and invalid ones removable only", () => {
    const shadowed = profileRowState(
      { ...base, source: "builtin", shadowed: true },
      "user",
      builtIns,
    );
    assert.equal(shadowed.canEdit, false);
    assert.equal(shadowed.remove, undefined);
    const invalid = profileRowState(
      { ...base, error: "bad yaml" },
      "user",
      builtIns,
    );
    assert.equal(invalid.canEdit, false);
    assert.equal(invalid.canEnable, false);
    assert.equal(invalid.remove, "delete");
  });
});

describe("profile summary", () => {
  it("summarizes model, thinking and permissions", () => {
    assert.equal(profileSummary(base, []), "Lead's model · Read-only");
    assert.equal(
      profileSummary(
        { ...base, model: "x/y", thinking: "high", permission: "autonomous" },
        [],
      ),
      "x/y · high thinking · Autonomous",
    );
  });
});
