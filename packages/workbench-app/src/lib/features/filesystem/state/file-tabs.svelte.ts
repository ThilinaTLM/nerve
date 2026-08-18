import { getFileContent } from "$lib/api";
import { fileViewKey, mermaidViewKey } from "$lib/core/state/state-keys";
import { defaultFileDisplayMode } from "@nervekit/ui-kit/core/utils/file-display";
import { fileState } from "$lib/features/filesystem/state/file-state.svelte";
import { notify } from "$lib/features/notifications/notify.svelte";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  replaceOpenCenterTabs,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/features/workspace/state/center-tabs.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { SvelteSet } from "svelte/reactivity";

function encodeFileTabId(projectId: string, path: string): string {
  return `${projectId}:${encodeURIComponent(path)}`;
}

function addFileTab(id: string) {
  addCenterTab({ kind: "file", id });
}

async function loadFileView(id: string) {
  const view = fileState.fileViews[fileViewKey(id)];
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
  if (input.projectId !== workspaceState.selectedProjectId) {
    const { selectProject } =
      await import("$lib/features/workspace/state/workspace-actions.svelte");
    await selectProject(input.projectId);
  }
  const id = encodeFileTabId(input.projectId, input.path);
  const key = fileViewKey(id);
  addFileTab(id);
  fileState.fileViews[key] ??= {
    id,
    projectId: input.projectId,
    path: input.path,
    line: input.line,
    loading: false,
  };
  fileState.fileViews[key].line = input.line;
  setActiveCenterTab({ kind: "file", id });
  await loadFileView(id);
}

export async function selectCenterFileTab(id: string) {
  const view = fileState.fileViews[fileViewKey(id)];
  if (!view) return;
  addFileTab(id);
  setActiveCenterTab({ kind: "file", id });
  if (!view.content && !view.loading) await loadFileView(id);
}

export async function refreshFilePane(id: string) {
  await loadFileView(id);
}

export function toggleFileDisplayMode(id: string) {
  const view = fileState.fileViews[fileViewKey(id)];
  if (!view) return;
  const current =
    view.displayMode ??
    defaultFileDisplayMode(view.content?.relativePath ?? view.path);
  view.displayMode = current === "raw" ? "rendered" : "raw";
}

export function toggleFileLineWrap(id: string) {
  const view = fileState.fileViews[fileViewKey(id)];
  if (!view) return;
  view.wrapLines = !view.wrapLines;
}

export function closeFileTabsAtPath(input: {
  projectId: string;
  path: string;
  descendants?: boolean;
}): void {
  const pathMatches = (projectId: string, path: string) =>
    projectId === input.projectId &&
    (path === input.path ||
      Boolean(input.descendants && path.startsWith(`${input.path}/`)));
  const matchingFileIds = new SvelteSet(
    Object.values(fileState.fileViews)
      .filter((view) =>
        pathMatches(view.projectId, view.content?.relativePath ?? view.path),
      )
      .map((view) => view.id),
  );
  const matchingMermaidIds = new SvelteSet(
    Object.values(fileState.mermaidViews)
      .filter((view) =>
        pathMatches(view.projectId, view.relativePath ?? view.path),
      )
      .map((view) => view.id),
  );
  if (matchingFileIds.size === 0 && matchingMermaidIds.size === 0) return;

  const active = workspaceState.activeCenterTab;
  const closesActive = Boolean(
    active &&
    ((active.kind === "file" && matchingFileIds.has(active.id)) ||
      (active.kind === "mermaid" && matchingMermaidIds.has(active.id))),
  );
  const remaining = workspaceState.openCenterTabs.filter(
    (tab) =>
      (tab.kind !== "file" || !matchingFileIds.has(tab.id)) &&
      (tab.kind !== "mermaid" || !matchingMermaidIds.has(tab.id)),
  );
  for (const id of matchingFileIds) delete fileState.fileViews[fileViewKey(id)];
  for (const id of matchingMermaidIds)
    delete fileState.mermaidViews[mermaidViewKey(id)];
  replaceOpenCenterTabs(remaining);
  if (closesActive) void selectCenterTab(remaining.at(-1));
}

export function closeFileTab(id: string) {
  const tab = { kind: "file" as const, id };
  const closingActive =
    workspaceState.activeCenterTab?.kind === "file" &&
    workspaceState.activeCenterTab.id === id;
  const fallback = nextCenterTabAfterClose(tab);
  removeCenterTab(tab);
  delete fileState.fileViews[fileViewKey(id)];
  if (closingActive) void selectCenterTab(fallback);
}
