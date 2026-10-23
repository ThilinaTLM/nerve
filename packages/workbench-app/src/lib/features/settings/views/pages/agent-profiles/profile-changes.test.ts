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
    assert.deepEqual(modesFor("lead"), ["set", "lock", "settings"]);
    assert.deepEqual(modesFor("subagent"), ["set", "lock", "settings", "lead"]);
    assert.deepEqual(modesFor("both"), ["set", "lock", "settings", "lead"]);
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

  it("writes and reads Reset to settings without a value", () => {
    assert.deepEqual(setChangePatch("permission", "settings", "x"), {
      permission: "settings",
    });
    assert.deepEqual(setChangePatch("tool:bash", "settings", {}), {
      tools: { bash: "settings" },
    });
    const row = changeRows({ ...planning, permission: "settings" }).find(
      (candidate) => candidate.key === "permission",
    );
    assert.deepEqual([row?.mode, row?.value], ["settings", undefined]);
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
      [
        "Reasoning",
        "set",
        {
          model: undefined,
          thinking: "low",
          modelMode: "set",
          thinkingMode: "set",
        },
      ],
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

  it("preserves independent model/reasoning modes through unrelated edits", () => {
    const model = { provider: "p", modelId: "m" };
    for (const fields of [
      { model: { lock: model }, thinking: { set: "low" as const } },
      { model: "lead" as const, thinking: { lock: "high" as const } },
      { model: { set: model }, thinking: "lead" as const },
    ]) {
      const row = changeRows({ ...planning, ...fields }).find(
        (row) => row.key === "model",
      )!;
      assert.deepEqual(setChangePatch("model", row.mode!, row.value), fields);
    }
    const reasoningLead = changeRows({ ...planning, thinking: "lead" }).find(
      (row) => row.key === "model",
    )!;
    assert.deepEqual(
      setChangePatch("model", reasoningLead.mode!, reasoningLead.value),
      { model: null, thinking: "lead" },
    );
    const row = changeRows({
      ...planning,
      model: { lock: model },
      thinking: { set: "low" },
    })[0]!;
    assert.deepEqual(
      setChangePatch("model", row.mode!, {
        ...(row.value as object),
        thinking: "high",
      }),
      {
        model: { lock: model },
        thinking: { set: "high" },
      },
    );
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
