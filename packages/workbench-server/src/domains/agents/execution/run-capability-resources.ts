import type { CapabilitySelection } from "@nervekit/contracts/capabilities";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ToolName } from "@nervekit/contracts/tools";
import type { LoadedHarnessResources } from "../prompting/resource-loader.js";
import { createCapabilityRefresher } from "./capability-refresh.js";
import { sameStringList } from "./harness-execution-shared.js";

interface HarnessMutations {
  setResources(resources: {
    skills: LoadedHarnessResources["skills"];
  }): Promise<unknown>;
  setActiveTools(names: ToolName[]): Promise<unknown>;
}

export interface RunCapabilityResources {
  selection(): CapabilitySelection;
  resources(): LoadedHarnessResources;
  activeToolNames(): ToolName[];
  /** Connects the live harness once it exists, so refreshes can push updates. */
  attach(harness: HarnessMutations): void;
  /** Re-resolves capabilities; call before composing a turn's system prompt. */
  refresh(): Promise<void>;
  /** Recomputes active tools after the agent's own configuration changed. */
  refreshActiveTools(agent: AgentRecord): Promise<void>;
}

/**
 * Owns the capability-derived state of one run. Capability toggles made while
 * the run is live must reach its next turn, so skills and active tools are
 * re-resolved instead of staying frozen at run start.
 */
export async function createRunCapabilityResources(deps: {
  resolveSelection: () => Promise<CapabilitySelection>;
  loadResources: (
    selection: CapabilitySelection,
  ) => Promise<LoadedHarnessResources>;
  resolveActiveToolNames: (
    agent: AgentRecord,
    disabledTools: CapabilitySelection["disabledTools"],
  ) => Promise<ToolName[]>;
  latestAgent: () => AgentRecord;
  onError?: (error: unknown) => void;
}): Promise<RunCapabilityResources> {
  let selection = await deps.resolveSelection();
  let resources = await deps.loadResources(selection);
  let activeToolNames = await deps.resolveActiveToolNames(
    deps.latestAgent(),
    selection.disabledTools,
  );
  let harness: HarnessMutations | undefined;

  const applyToolNames = async (next: ToolName[]): Promise<void> => {
    if (sameStringList(next, activeToolNames)) return;
    activeToolNames = next;
    await harness?.setActiveTools(next);
  };

  const refresher = createCapabilityRefresher({
    initialSelection: selection,
    resolve: deps.resolveSelection,
    loadResources: (next) => {
      selection = next;
      return deps.loadResources(next);
    },
    applyResources: async (next) => {
      resources = next;
      await harness?.setResources({ skills: next.skills });
    },
    applyToolNames: async (next) => {
      selection = next;
      await applyToolNames(
        await deps.resolveActiveToolNames(
          deps.latestAgent(),
          next.disabledTools,
        ),
      );
    },
    onError: deps.onError,
  });

  return {
    selection: () => selection,
    resources: () => resources,
    activeToolNames: () => activeToolNames,
    attach: (next) => {
      harness = next;
    },
    refresh: () => refresher.refresh(),
    refreshActiveTools: async (agent) => {
      await applyToolNames(
        await deps.resolveActiveToolNames(agent, selection.disabledTools),
      );
    },
  };
}
