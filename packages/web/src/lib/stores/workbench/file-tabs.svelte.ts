import { toast } from "svelte-sonner";
import { getFileContent } from "../../api";
import { activateFallbackCenterTab } from "./center-tabs.svelte";
import { workbenchState } from "./state.svelte";

function encodeFileTabId(projectId: string, path: string): string {
  return `${projectId}:${encodeURIComponent(path)}`;
}

function addFileTab(id: string) {
  if (!workbenchState.openFileTabIds.includes(id)) {
    workbenchState.openFileTabIds = [...workbenchState.openFileTabIds, id];
  }
}

async function loadFileView(id: string) {
  const view = workbenchState.fileViews[id];
  if (!view) return;
  view.loading = true;
  view.error = undefined;
  try {
    view.content = await getFileContent(view.projectId, view.path);
    view.path = view.content.path;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    view.error = message;
    toast.error("Could not open file", { description: message });
  } finally {
    view.loading = false;
  }
}

export async function openFilePane(input: {
  projectId: string;
  path: string;
  line?: number;
}) {
  const id = encodeFileTabId(input.projectId, input.path);
  addFileTab(id);
  workbenchState.fileViews[id] ??= {
    id,
    projectId: input.projectId,
    path: input.path,
    line: input.line,
    loading: false,
  };
  workbenchState.fileViews[id].line = input.line;
  workbenchState.activeCenterTab = { kind: "file", id };
  await loadFileView(id);
}

export async function selectCenterFileTab(id: string) {
  const view = workbenchState.fileViews[id];
  if (!view) return;
  addFileTab(id);
  workbenchState.activeCenterTab = { kind: "file", id };
  if (!view.content && !view.loading) await loadFileView(id);
}

export async function refreshFilePane(id: string) {
  await loadFileView(id);
}

export function closeFileTab(id: string) {
  workbenchState.openFileTabIds = workbenchState.openFileTabIds.filter(
    (candidate) => candidate !== id,
  );
  delete workbenchState.fileViews[id];
  if (
    workbenchState.activeCenterTab?.kind === "file" &&
    workbenchState.activeCenterTab.id === id
  ) {
    activateFallbackCenterTab();
  }
}
