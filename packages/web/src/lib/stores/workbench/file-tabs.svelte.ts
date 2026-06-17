import { notify } from "$lib/features/notifications/notify.svelte";
import { getFileContent } from "../../api";
import {
  defaultFileDisplayMode,
  type FileDisplayMode,
} from "../../utils/file-display";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "./center-tabs.svelte";
import { workbenchState } from "./state.svelte";
import { fileViewKey } from "./state-keys";

function encodeFileTabId(projectId: string, path: string): string {
  return `${projectId}:${encodeURIComponent(path)}`;
}

function addFileTab(id: string) {
  addCenterTab({ kind: "file", id });
}

async function loadFileView(id: string) {
  const view = workbenchState.fileViews[fileViewKey(id)];
  if (!view) return;
  view.loading = true;
  view.error = undefined;
  try {
    view.content = await getFileContent(view.projectId, view.path, view.line);
    view.path = view.content.path;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    view.error = message;
    notify.error("Could not open file", { description: message });
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
  const key = fileViewKey(id);
  addFileTab(id);
  workbenchState.fileViews[key] ??= {
    id,
    projectId: input.projectId,
    path: input.path,
    line: input.line,
    loading: false,
  };
  workbenchState.fileViews[key].line = input.line;
  setActiveCenterTab({ kind: "file", id });
  await loadFileView(id);
}

export async function selectCenterFileTab(id: string) {
  const view = workbenchState.fileViews[fileViewKey(id)];
  if (!view) return;
  addFileTab(id);
  setActiveCenterTab({ kind: "file", id });
  if (!view.content && !view.loading) await loadFileView(id);
}

export async function refreshFilePane(id: string) {
  await loadFileView(id);
}

export async function refreshActiveFilePane() {
  const active = workbenchState.activeCenterTab;
  if (active?.kind !== "file") return;
  await refreshFilePane(active.id);
}

export function setFileDisplayMode(id: string, mode: FileDisplayMode) {
  const view = workbenchState.fileViews[fileViewKey(id)];
  if (!view) return;
  view.displayMode = mode;
}

export function toggleFileDisplayMode(id: string) {
  const view = workbenchState.fileViews[fileViewKey(id)];
  if (!view) return;
  const current =
    view.displayMode ??
    defaultFileDisplayMode(view.content?.relativePath ?? view.path);
  view.displayMode = current === "raw" ? "rendered" : "raw";
}

export function toggleFileLineWrap(id: string) {
  const view = workbenchState.fileViews[fileViewKey(id)];
  if (!view) return;
  view.wrapLines = !view.wrapLines;
}

export function closeFileTab(id: string) {
  const tab = { kind: "file" as const, id };
  const closingActive =
    workbenchState.activeCenterTab?.kind === "file" &&
    workbenchState.activeCenterTab.id === id;
  const fallback = nextCenterTabAfterClose(tab);
  removeCenterTab(tab);
  delete workbenchState.fileViews[fileViewKey(id)];
  if (closingActive) void selectCenterTab(fallback);
}
