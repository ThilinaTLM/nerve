import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CapabilitySelection } from "@nervekit/contracts/capabilities";
import { createCapabilityRefresher } from "../../../src/domains/agents/execution/capability-refresh.js";

const selection = (
  overrides: Partial<CapabilitySelection> = {},
): CapabilitySelection => ({
  disabledTools: [],
  disabledFileSkills: [],
  enabledAgentBrowserSkills: [],
  ...overrides,
});

function harness(selections: CapabilitySelection[]) {
  const loaded: CapabilitySelection[] = [];
  const appliedResources: string[][] = [];
  const appliedTools: string[][] = [];
  let index = 0;
  const refresher = createCapabilityRefresher({
    initialSelection: selections[0],
    resolve: async () => selections[Math.min(++index, selections.length - 1)],
    loadResources: async (next) => {
      loaded.push(next);
      return { skills: next.disabledFileSkills };
    },
    applyResources: async (resources) => {
      appliedResources.push(resources.skills);
    },
    applyToolNames: async (next) => {
      appliedTools.push([...next.disabledTools]);
    },
  });
  return { refresher, loaded, appliedResources, appliedTools };
}

describe("createCapabilityRefresher", () => {
  it("reloads and republishes skills when the selection changed", async () => {
    const { refresher, loaded, appliedResources } = harness([
      selection(),
      selection({ disabledFileSkills: ["review"] }),
    ]);

    await refresher.refresh();

    assert.deepEqual(
      loaded.map((entry) => entry.disabledFileSkills),
      [["review"]],
    );
    assert.deepEqual(appliedResources, [["review"]]);
  });

  it("does nothing when the resolved selection is unchanged", async () => {
    const { refresher, loaded, appliedResources, appliedTools } = harness([
      selection({ enabledAgentBrowserSkills: ["core", "slack"] }),
      selection({ enabledAgentBrowserSkills: ["slack", "core"] }),
    ]);

    await refresher.refresh();
    await refresher.refresh();

    assert.deepEqual(loaded, []);
    assert.deepEqual(appliedResources, []);
    assert.deepEqual(appliedTools, []);
  });

  it("updates active tools without reloading skills for tool-only changes", async () => {
    const { refresher, loaded, appliedTools } = harness([
      selection(),
      selection({ disabledTools: ["web_search"] }),
    ]);

    await refresher.refresh();

    assert.deepEqual(appliedTools, [["web_search"]]);
    assert.deepEqual(loaded, []);
  });

  it("surfaces failures without breaking later refreshes", async () => {
    const errors: unknown[] = [];
    let attempt = 0;
    const refresher = createCapabilityRefresher({
      initialSelection: selection(),
      resolve: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("unreadable capabilities");
        return selection({ disabledFileSkills: ["review"] });
      },
      loadResources: async () => ({ skills: ["review"] }),
      applyResources: async () => undefined,
      applyToolNames: async () => undefined,
      onError: (error) => errors.push(error),
    });

    await refresher.refresh();
    assert.equal(errors.length, 1);
    await refresher.refresh();
    assert.equal(errors.length, 1);
  });
});
