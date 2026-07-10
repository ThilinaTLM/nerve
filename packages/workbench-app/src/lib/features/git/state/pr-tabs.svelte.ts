import { getGithubPr } from "$lib/api";
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
  const id = encodePrTabId(input.projectId, input.repo, input.number);
  const key = prViewKey(id);
  addPrTab(id);
  gitState.prViews[key] ??= {
    id,
    projectId: input.projectId,
    repo: input.repo,
    number: input.number,
    loading: false,
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
