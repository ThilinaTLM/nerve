import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyCapabilityOverrides } from "@nervekit/contracts/capabilities";
import {
  harnessOverrideCount,
  harnessResetPatch,
  projectPageDiffs,
  skillsResetPatch,
  toolsResetPatch,
} from "./project-diff";

describe("project differences", () => {
  it("counts overridden harness leaves and resets only known keys", () => {
    const overrides = {
      version: 4 as const,
      defaults: { permissionRuleSetId: "supervised" },
      compaction: { auto: false, profile: "custom" as const },
      extension: { kept: true },
    };
    assert.equal(harnessOverrideCount(overrides), 3);
    assert.deepEqual(harnessResetPatch(overrides), {
      defaults: null,
      compaction: null,
    });
    assert.equal(harnessOverrideCount(undefined), 0);
  });

  it("resets every stored tool entry and skill override", () => {
    const document = {
      ...emptyCapabilityOverrides(),
      tools: {
        web_search: { enabled: false },
        bash: { settings: {} as never },
      },
      skills: {
        file: { review: false },
        nerve: {},
        agentBrowser: { core: true },
      },
    };
    assert.deepEqual(toolsResetPatch(document), {
      tools: { web_search: null, bash: null },
    });
    assert.deepEqual(skillsResetPatch(document), {
      skills: {
        file: { review: null },
        nerve: {},
        agentBrowser: { core: null },
      },
    });
    assert.deepEqual(
      projectPageDiffs({
        capabilities: document,
        agentFiles: 1,
        subAgentFiles: 2,
      }),
      { general: 0, tools: 2, skills: 2, agents: 1, "sub-agents": 2 },
    );
  });
});
