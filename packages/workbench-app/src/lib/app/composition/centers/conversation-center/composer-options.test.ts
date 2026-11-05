import assert from "node:assert/strict";
import { test } from "node:test";
import type { PermissionRuleSetSummary } from "@nervekit/contracts/permissions";
import type { ProfileOption } from "$lib/application/agent-profiles/agent-profile-catalog.svelte";
import { composerProfiles, permissionRuleSetsFor } from "./composer-options";

const profile = (name: string, source: ProfileOption["source"]) => ({
  name,
  label: name.toUpperCase(),
  whenToUse: `use ${name}`,
  usableBy: "both" as const,
  defaultEnabled: true,
  source,
});

test("composerProfiles offers only the viewed child's own profile, read-only", () => {
  const profiles = [profile("coder", "user"), profile("plan", "builtin")];
  assert.deepEqual(
    composerProfiles({
      viewingChild: true,
      selectedProfile: "coder",
      resolvedProfiles: profiles,
      leadProfiles: [profiles[1]!],
    }),
    [{ name: "coder", label: "coder", source: "user" }],
  );
});

test("composerProfiles lists lead profiles with their labels", () => {
  const lead = [profile("plan", "builtin")];
  assert.deepEqual(
    composerProfiles({
      viewingChild: false,
      selectedProfile: "plan",
      resolvedProfiles: lead,
      leadProfiles: lead,
    }),
    [
      {
        name: "plan",
        label: "PLAN",
        whenToUse: "use plan",
        source: "builtin",
      },
    ],
  );
});

test("permissionRuleSetsFor restricts a viewed sub-agent to read-only or autonomous", () => {
  const sets = ["read_only", "supervised", "autonomous"].map((id) => ({
    id,
  })) as PermissionRuleSetSummary[];
  assert.deepEqual(
    permissionRuleSetsFor(sets, true).map((s) => s.id),
    ["read_only", "autonomous"],
  );
  assert.equal(permissionRuleSetsFor(sets, false).length, 3);
});
