import { notify } from "$lib/features/notifications/notify.svelte";
import { getGithubPr } from "../../api";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "./center-tabs.svelte";
import { workbenchState } from "./state.svelte";
import { prViewKey } from "./state-keys";

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
  const view = workbenchState.prViews[prViewKey(id)];
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
  workbenchState.prViews[key] ??= {
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
  const view = workbenchState.prViews[prViewKey(id)];
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
    workbenchState.activeCenterTab?.kind === "pr" &&
    workbenchState.activeCenterTab.id === id;
  const fallback = nextCenterTabAfterClose(tab);
  removeCenterTab(tab);
  delete workbenchState.prViews[prViewKey(id)];
  if (closingActive) void selectCenterTab(fallback);
}
