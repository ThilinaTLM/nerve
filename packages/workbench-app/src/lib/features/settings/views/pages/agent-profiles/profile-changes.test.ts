import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentProfileDraft } from "@nervekit/contracts/agent-profiles";
import {
  changeRows,
  modesFor,
  nameFromLabel,
  removeChangePatch,
  setChangePatch,
  skillsSummary,
} from "./profile-changes.js";

const planning: AgentProfileDraft = {
  name: "planning",
  description: "Plan first",
  usableBy: "lead",
  instructions: "Read the planning skill.",
  permission: { lock: "planning" },
  tools: {
    plan_present: {
      set: { enabled: true, settings: { approvalProfile: "coding" } },
    },
  },
};

describe("profile changes", () => {
  it("lists a template's settings with their modes", () => {
    assert.deepEqual(
      changeRows(planning).map((row) => [row.key, row.mode]),
      [
        ["permission", "lock"],
        ["tool:plan_present", "set"],
        ["instructions", undefined],
      ],
    );
  });

  it("offers Same as lead only to profiles usable by sub-agents", () => {
    assert.deepEqual(modesFor("lead"), ["set", "lock"]);
    assert.deepEqual(modesFor("subagent"), ["set", "lock", "lead"]);
    assert.deepEqual(modesFor("both"), ["set", "lock", "lead"]);
  });

  it("builds patches that set and remove a change", () => {
    assert.deepEqual(setChangePatch("permission", "lock", "read_only"), {
      permission: { lock: "read_only" },
    });
    assert.deepEqual(setChangePatch("model", "lead", undefined), {
      model: "lead",
      thinking: "lead",
    });
    assert.deepEqual(setChangePatch("tool:jira", "set", { enabled: true }), {
      tools: { jira: { set: { enabled: true } } },
    });
    assert.deepEqual(removeChangePatch("tool:jira"), { tools: { jira: null } });
    assert.deepEqual(removeChangePatch("compaction"), { compaction: null });
  });

  it("combines model and reasoning into one change", () => {
    const reasoningOnly: AgentProfileDraft = {
      ...planning,
      thinking: { set: "low" },
    };
    const row = changeRows(reasoningOnly).find(
      (candidate) => candidate.key === "model",
    );
    assert.deepEqual(
      [row?.label, row?.mode, row?.value],
      ["Reasoning", "set", { model: undefined, thinking: "low" }],
    );
    assert.deepEqual(setChangePatch("model", "lock", { thinking: "low" }), {
      model: null,
      thinking: { lock: "low" },
    });
    assert.deepEqual(
      setChangePatch("model", "set", {
        model: { provider: "p", modelId: "m" },
        thinking: "high",
      }),
      {
        model: { set: { provider: "p", modelId: "m" } },
        thinking: { set: "high" },
      },
    );
    assert.deepEqual(removeChangePatch("model"), {
      model: null,
      thinking: null,
    });
  });

  it("summarises skills and derives names from labels", () => {
    assert.equal(
      skillsSummary({
        file: { docs: false },
        nerve: { planning: true },
        agentBrowser: {},
      }),
      "− docs, + planning",
    );
    assert.equal(skillsSummary("none"), "None");
    assert.equal(nameFromLabel("  Release Notes! "), "release-notes");
  });
});
