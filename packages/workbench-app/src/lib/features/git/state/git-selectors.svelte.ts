import { modelKey } from "$lib/presentation/utils/model";
import {
  gitProjectStateKey,
  gitRepoStateKey,
  prViewKey,
} from "$lib/domain/navigation/view-keys";
import type { AgentRecord } from "$lib/api";

export interface GitSelectorWorkspaceReadModel {
  readonly activeCenterTab: { kind: string; id: string } | undefined;
  readonly activeProjectId: string | undefined;
  readonly activeConversationBranchDepth: number;
  readonly agents: AgentRecord[];
  readonly selectedAgentId: string | undefined;
}

let workspaceReadModel: GitSelectorWorkspaceReadModel = {
  activeCenterTab: undefined,
  activeProjectId: undefined,
  activeConversationBranchDepth: 0,
  agents: [],
  selectedAgentId: undefined,
};

export function registerGitSelectorWorkspaceReadModel(
  readModel: GitSelectorWorkspaceReadModel,
): void {
  workspaceReadModel = readModel;
}
import { gitPanelState } from "./git-panel.svelte";
import { gitState } from "./git-state.svelte";

export const gitSelectors = {
  get activeCenterPrView() {
    const active = workspaceReadModel.activeCenterTab;
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
    const projectId = workspaceReadModel.activeProjectId;
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
    return workspaceReadModel.activeConversationBranchDepth;
  },
};

export function activeModelKeyForGit(): string {
  return modelKey(
    workspaceReadModel.agents.find(
      (agent) => agent.id === workspaceReadModel.selectedAgentId,
    )?.model ?? {
      provider: "",
      modelId: "",
    },
  );
}
