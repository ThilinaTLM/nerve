import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProfileCatalogEntry } from "@nervekit/contracts/agent-configuration";
import {
  groupProfiles,
  parseProfileRowId,
  profileRowId,
} from "./profile-groups";

const entry = (
  name: string,
  source: ProfileCatalogEntry["source"],
  usableBy: "lead" | "subagent" | "both" = "lead",
  extra: Partial<ProfileCatalogEntry> = {},
): ProfileCatalogEntry => ({
  name,
  source,
  path: `${source}:${name}`,
  digest: "d",
  definition: {
    schemaVersion: 1,
    name,
    whenToUse: "Use when testing",
    usableBy,
    instructions: "",
  },
  trusted: true,
  applicable: true,
  enabled: true,
  local: true,
  diagnostics: [],
  ...extra,
});

test("profiles group by origin, keep their kind, and mark copies that hide another", () => {
  const groups = groupProfiles({
    kind: "subagent",
    user: [
      entry("scout", "builtin", "subagent"),
      entry("planner", "builtin", "lead"),
      entry("mine", "user", "both", { shadows: "builtin" }),
    ],
    project: [entry("scout", "project", "subagent", { shadows: "builtin" })],
  });
  assert.deepEqual(
    groups.builtin.map((row) => [row.name, row.replacedBy]),
    [["scout", "project"]],
  );
  assert.deepEqual(
    groups.user.map((row) => [row.name, row.replaces]),
    [["mine", "builtin"]],
  );
  assert.deepEqual(
    groups.project.map((row) => [row.id, row.replaces]),
    [["project:scout", "builtin"]],
  );
});

test("row ids round-trip even for names with a colon-free slug", () => {
  assert.deepEqual(parseProfileRowId(profileRowId("user", "a-b")), {
    origin: "user",
    name: "a-b",
  });
  assert.equal(parseProfileRowId("nope"), undefined);
});
