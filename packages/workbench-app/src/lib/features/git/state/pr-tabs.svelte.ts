import { getGithubPr, getGithubPrFiles } from "$lib/api";
import type { GithubPrMergeMethod } from "@nervekit/contracts";
import { prViewKey } from "$lib/core/state/state-keys";
import { gitState } from "$lib/features/git/state/git-state.svelte";
import { notify } from "$lib/features/notifications/notify.svelte";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/features/workspace/state/center-tabs.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";

function encodePrTabId(
  projectId: string,
  repo: string,
  number: number,
): string {
  return `${projectId}:${encodeURIComponent(repo)}:${number}`;
}

function addPrTab(id: string) {
  addCenterTab({ kind: "pr", id });
}

async function loadPrView(id: string) {
  const view = gitState.prViews[prViewKey(id)];
  if (!view || view.loading) return;
  view.loading = true;
  view.error = undefined;
  try {
    view.detail = await getGithubPr(view.projectId, view.repo, view.number);
    const allowed = view.detail.mergeSettings.allowedMethods;
    if (
      !view.selectedMergeMethod ||
      !allowed.includes(view.selectedMergeMethod)
    ) {
      view.selectedMergeMethod = (["merge", "squash", "rebase"] as const).find(
        (method) => allowed.includes(method),
      );
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    view.error = message;
    notify.error("Could not open pull request", { description: message });
  } finally {
    view.loading = false;
  }
}

export async function openPrPane(input: {
  projectId: string;
  repo: string;
  number: number;
}) {
  if (input.projectId !== workspaceState.selectedProjectId) {
    const { selectProject } =
      await import("$lib/features/workspace/state/workspace-actions.svelte");
    await selectProject(input.projectId);
  }
  const id = encodePrTabId(input.projectId, input.repo, input.number);
  const key = prViewKey(id);
  addPrTab(id);
  gitState.prViews[key] ??= {
    id,
    projectId: input.projectId,
    repo: input.repo,
    number: input.number,
    loading: false,
    activeTab: "conversation",
    filesLoading: false,
    merging: false,
  };
  setActiveCenterTab({ kind: "pr", id });
  await loadPrView(id);
}

export async function selectCenterPrTab(id: string) {
  const view = gitState.prViews[prViewKey(id)];
  if (!view) return;
  addPrTab(id);
  setActiveCenterTab({ kind: "pr", id });
  if (!view.detail && !view.loading) await loadPrView(id);
}

export async function refreshPrPane(id: string) {
  await loadPrView(id);
}

export async function loadPrFiles(id: string, force = false) {
  const view = gitState.prViews[prViewKey(id)];
  if (!view || view.filesLoading || (view.files && !force)) return;
  view.filesLoading = true;
  view.filesError = undefined;
  try {
    view.files = await getGithubPrFiles(view.projectId, view.repo, view.number);
    if (
      !view.selectedFilePath ||
      !view.files.files.some((file) => file.path === view.selectedFilePath)
    ) {
      view.selectedFilePath = view.files.files[0]?.path;
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    view.filesError = message;
    notify.error("Could not load pull request files", { description: message });
  } finally {
    view.filesLoading = false;
  }
}

export function selectPrTab(
  id: string,
  tab: "conversation" | "commits" | "checks" | "files",
) {
  const view = gitState.prViews[prViewKey(id)];
  if (!view) return;
  view.activeTab = tab;
  if (tab === "files") void loadPrFiles(id);
}

export function selectPrFile(id: string, path: string) {
  const view = gitState.prViews[prViewKey(id)];
  if (view) view.selectedFilePath = path;
}

export function selectPrMergeMethod(id: string, method: GithubPrMergeMethod) {
  const view = gitState.prViews[prViewKey(id)];
  if (view) view.selectedMergeMethod = method;
}

export function closePrTab(id: string) {
  const tab = { kind: "pr" as const, id };
  const closingActive =
    workspaceState.activeCenterTab?.kind === "pr" &&
    workspaceState.activeCenterTab.id === id;
  const fallback = nextCenterTabAfterClose(tab);
  removeCenterTab(tab);
  delete gitState.prViews[prViewKey(id)];
  if (closingActive) void selectCenterTab(fallback);
}
