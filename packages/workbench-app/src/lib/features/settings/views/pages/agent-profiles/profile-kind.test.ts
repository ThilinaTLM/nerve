import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentProfileConfiguration,
  AgentProfileUsableBy,
} from "@nervekit/contracts/agent-profiles";
import {
  profileBelongsTo,
  profileFileCount,
  profileKindForPage,
  profilesOfKind,
  storedUsableBy,
  unreadableProfiles,
} from "./profile-kind.js";

function profile(
  name: string,
  shape: {
    effective?: AgentProfileUsableBy;
    local?: AgentProfileUsableBy;
  } = {},
): AgentProfileConfiguration {
  return {
    name,
    ...(shape.effective ? { effective: { usableBy: shape.effective } } : {}),
    ...(shape.local ? { local: { usableBy: shape.local } } : {}),
  } as unknown as AgentProfileConfiguration;
}

const lead = profile("lead", { effective: "lead" });
const sub = profile("sub", { effective: "subagent" });
const both = profile("both", { effective: "both" });
const localOnly = profile("local-only", { local: "subagent" });
const unreadable = profile("broken");
const all = [lead, sub, both, localOnly, unreadable];

const names = (list: AgentProfileConfiguration[]) =>
  list.map((item) => item.name);

describe("profile kind pages", () => {
  it("maps page ids to kinds, defaulting to lead", () => {
    assert.equal(profileKindForPage("sub-agents"), "subagent");
    assert.equal(profileKindForPage("agents"), "lead");
  });

  it("keeps each kind on its own page and legacy both on each", () => {
    assert.deepEqual(names(profilesOfKind(all, "lead")), ["lead", "both"]);
    assert.deepEqual(names(profilesOfKind(all, "subagent")), [
      "sub",
      "both",
      "local-only",
    ]);
  });

  it("falls back to the local definition when there is no effective one", () => {
    assert.equal(storedUsableBy(localOnly), "subagent");
    assert.equal(profileBelongsTo(localOnly, "subagent"), true);
    assert.equal(profileBelongsTo(localOnly, "lead"), false);
    assert.equal(
      storedUsableBy(profile("x", { effective: "lead", local: "subagent" })),
      "lead",
    );
  });

  it("lists unreadable files on neither kind but reports them separately", () => {
    assert.equal(storedUsableBy(unreadable), undefined);
    assert.equal(profileBelongsTo(unreadable, "lead"), false);
    assert.deepEqual(names(unreadableProfiles(all)), ["broken"]);
  });

  it("does not mutate its input and preserves order", () => {
    const input = [sub, lead, both];
    const copy = [...input];
    const result = profilesOfKind(input, "subagent");
    assert.deepEqual(input, copy);
    assert.notEqual(result, input);
    assert.deepEqual(names(result), ["sub", "both"]);
  });

  it("counts files per kind, including both", () => {
    const files = [
      { usableBy: "lead" },
      { usableBy: "subagent" },
      { usableBy: "both" },
      {},
    ] as const;
    assert.equal(profileFileCount(files, "lead"), 2);
    assert.equal(profileFileCount(files, "subagent"), 2);
  });
});
