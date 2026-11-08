import { SvelteURL } from "svelte/reactivity";
import { repoPrRepositoryUrl } from "./pr-store.svelte";
import { prViewKey } from "$lib/domain/navigation/view-keys";

export interface GitSelectorWorkspaceReadModel {
  readonly activeCenterTab: { kind: string; id: string } | undefined;
  readonly activeProjectId: string | undefined;
}

const unregisteredWorkspaceReadModel: GitSelectorWorkspaceReadModel = {
  activeCenterTab: undefined,
  activeProjectId: undefined,
};

let workspaceReadModel = unregisteredWorkspaceReadModel;

export function registerGitSelectorWorkspaceReadModel(
  readModel: GitSelectorWorkspaceReadModel,
): () => void {
  workspaceReadModel = readModel;
  return () => {
    if (workspaceReadModel === readModel)
      workspaceReadModel = unregisteredWorkspaceReadModel;
  };
}
import { selectedGitRepo } from "./git-panel-state.svelte";
import { gitWorkspaceSnapshot } from "./git-store.svelte";
import { gitState } from "./git-state.svelte";

export const gitSelectors = {
  /** Root repository identity already loaded by the Git panel; never fetches. */
  githubRepository(projectId: string): string | undefined {
    const repositoryUrl = repoPrRepositoryUrl(projectId, ".");
    if (!repositoryUrl) return undefined;
    const url = new SvelteURL(repositoryUrl);
    return `${url.host}${url.pathname}`.toLowerCase();
  },
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
    const repos = projectId
      ? gitWorkspaceSnapshot(projectId)?.summaries
      : undefined;
    if (!projectId || !repos || repos.length === 0) return undefined;
    const selected = selectedGitRepo(projectId);
    const repo =
      repos.find((candidate) => candidate.relativePath === selected) ??
      repos[0];
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
      repoCount: repos.length,
    };
  },
};

/** Checked-out branch of one repository, used to detect PR checkout state. */
export function gitCurrentBranch(
  projectId: string,
  relativePath: string,
): string | undefined {
  return (
    gitWorkspaceSnapshot(projectId)?.summaries.find(
      (candidate) => candidate.relativePath === relativePath,
    )?.currentBranch ?? undefined
  );
}
