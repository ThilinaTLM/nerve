import { modelKey } from "@nervekit/workbench-ui/core/utils/model";
import {
  conversationViewKey,
  gitProjectStateKey,
  gitRepoStateKey,
  prViewKey,
} from "$lib/core/state/state-keys";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import { workspaceSelectors } from "$lib/features/workspace/state/workspace-selectors.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { gitPanelState } from "./git-panel.svelte";
import { gitState } from "./git-state.svelte";
import { buildGitSuggestions, type GitSuggestion } from "./git-suggestions";

function activeView() {
  const conversationId =
    selection.conversationId ?? conversationState.activeConversationTabId;
  if (!conversationId) return undefined;
  return conversationState.conversationViews[
    conversationViewKey(conversationId)
  ];
}

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
  get gitSuggestions(): GitSuggestion[] {
    const ctx = gitState.gitContext;
    const projectId = workspaceSelectors.activeProject?.id;
    if (!ctx || !projectId || ctx.projectId !== projectId) return [];
    return buildGitSuggestions(ctx);
  },
  get branchDepth() {
    return activeView()?.treeNodes.length ?? 0;
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
