import { modelKey } from "$lib/presentation/utils/model";
import {
  gitProjectStateKey,
  gitRepoStateKey,
  prViewKey,
} from "$lib/domain/navigation/view-keys";
import { selection } from "$lib/application/workspace/selection.svelte";
import { workspaceSelectors } from "$lib/application/workspace/workspace-selectors.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { gitPanelState } from "./git-panel.svelte";
import { gitState } from "./git-state.svelte";

export const gitSelectors = {
  get activeCenterPrView() {
    const active = workspaceState.activeCenterTab;
    if (active?.kind !== "pr") return undefined;
    return gitState.prViews[prViewKey(active.id)];
  },
  get gitStatus():
    | {
        branch: string;
        dirty: boolean;
        changeCount: number;
        ahead: number | null;
        behind: number | null;
        detached: boolean;
        hasUpstream: boolean;
        relativePath: string;
        repoName: string;
        repoCount: number;
      }
    | undefined {
    const projectId = workspaceSelectors.activeProject?.id;
    const state = projectId
      ? gitPanelState.projects[gitProjectStateKey(projectId)]
      : undefined;
    if (!state || state.repos.length === 0) return undefined;
    const repoState = state.repoStates[gitRepoStateKey(state.selectedRepo)];
    const repo =
      repoState?.repoSummary ??
      state.repos.find(
        (candidate) => candidate.relativePath === state.selectedRepo,
      ) ??
      state.repos[0];
    return {
      branch: repo.currentBranch ?? "detached",
      dirty: repo.dirty,
      changeCount: repo.changeCount,
      ahead: repo.ahead,
      behind: repo.behind,
      detached: repo.detached,
      hasUpstream: repo.hasUpstream,
      relativePath: repo.relativePath,
      repoName: repo.name,
      repoCount: state.repos.length,
    };
  },
  get branchDepth() {
    return workspaceSelectors.activeConversationBranchDepth;
  },
};

export function activeModelKeyForGit(): string {
  return modelKey(
    workspaceState.agents.find((agent) => agent.id === selection.agentId)
      ?.model ?? {
      provider: "",
      modelId: "",
    },
  );
}
