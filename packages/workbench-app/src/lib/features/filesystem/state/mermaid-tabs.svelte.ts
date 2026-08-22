import { getFileContent } from "$lib/api";
import { mermaidViewKey } from "$lib/kernel/navigation/view-keys";
import { notify } from "$lib/application/notifications/notify.svelte";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/application/workspace/center-tabs.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { recordTabsChanged } from "$lib/application/workspace/workspace-tab-sessions";
import {
  extractMermaidMarkdownBlocks,
  resolveMermaidMarkdownBlock,
  type MermaidMarkdownBlock,
} from "@nervekit/ui-kit/core/components/mermaid-blocks";
import { fileState } from "./file-state.svelte";

function encodeMermaidTabId(
  projectId: string,
  path: string,
  block: MermaidMarkdownBlock,
): string {
  return `${projectId}:${encodeURIComponent(path)}:mermaid:${block.locator.startLine}:${block.locator.fingerprint}`;
}

function existingViewId(
  projectId: string,
  path: string,
  block: MermaidMarkdownBlock,
): string | undefined {
  const candidates = Object.values(fileState.mermaidViews).filter(
    (view) =>
      view.projectId === projectId &&
      view.path === path &&
      view.locator.fingerprint === block.locator.fingerprint,
  );
  return candidates.reduce<string | undefined>((closestId, candidate) => {
    if (!closestId) return candidate.id;
    const closest = fileState.mermaidViews[mermaidViewKey(closestId)];
    return Math.abs(candidate.locator.startLine - block.locator.startLine) <
      Math.abs(
        (closest?.locator.startLine ?? Number.POSITIVE_INFINITY) -
          block.locator.startLine,
      )
      ? candidate.id
      : closestId;
  }, undefined);
}

async function loadMermaidView(id: string) {
  const view = fileState.mermaidViews[mermaidViewKey(id)];
  if (!view) return;
  view.loading = true;
  view.error = undefined;
  try {
    const content = await getFileContent(
      view.projectId,
      view.path,
      view.locator.startLine,
    );
    if (content.type !== "text" || content.text === undefined) {
      throw new Error("The source Markdown file is not readable as text.");
    }
    const blocks = extractMermaidMarkdownBlocks(
      content.text,
      content.lineStart ?? 1,
    );
    const resolved = resolveMermaidMarkdownBlock(blocks, view.locator, {
      completeDocument: !content.truncated,
    });
    if (!resolved) {
      throw new Error("The referenced Mermaid block no longer exists.");
    }
    view.path = content.path;
    view.relativePath = content.relativePath;
    view.name = content.name;
    view.locator = resolved.locator;
    view.source = resolved.source;
    view.truncated = content.truncated;
    recordTabsChanged();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    view.error = message;
    notify.error("Could not open Mermaid diagram", { description: message });
  } finally {
    view.loading = false;
  }
}

export async function openMarkdownMermaidPane(input: {
  projectId: string;
  path: string;
  relativePath?: string;
  name?: string;
  block: MermaidMarkdownBlock;
}) {
  if (input.projectId !== workspaceState.selectedProjectId) {
    const { selectProject } =
      await import("$lib/application/workspace/workspace-actions.svelte");
    await selectProject(input.projectId);
  }
  const existing = existingViewId(input.projectId, input.path, input.block);
  const id =
    existing ?? encodeMermaidTabId(input.projectId, input.path, input.block);
  const key = mermaidViewKey(id);
  fileState.mermaidViews[key] ??= {
    id,
    projectId: input.projectId,
    path: input.path,
    relativePath: input.relativePath,
    name: input.name,
    locator: input.block.locator,
    source: input.block.source,
    loading: false,
  };
  const view = fileState.mermaidViews[key];
  view.source = input.block.source;
  view.locator = input.block.locator;
  view.error = undefined;
  addCenterTab({ kind: "mermaid", id });
  setActiveCenterTab({ kind: "mermaid", id });
}

export async function selectCenterMermaidTab(id: string) {
  const view = fileState.mermaidViews[mermaidViewKey(id)];
  if (!view) return;
  addCenterTab({ kind: "mermaid", id });
  setActiveCenterTab({ kind: "mermaid", id });
  if (!view.source && !view.loading) await loadMermaidView(id);
}

export async function refreshMermaidPane(id: string) {
  await loadMermaidView(id);
}

export function closeMermaidTab(id: string) {
  const tab = { kind: "mermaid" as const, id };
  const closingActive =
    workspaceState.activeCenterTab?.kind === "mermaid" &&
    workspaceState.activeCenterTab.id === id;
  const fallback = nextCenterTabAfterClose(tab);
  removeCenterTab(tab);
  delete fileState.mermaidViews[mermaidViewKey(id)];
  if (closingActive) void selectCenterTab(fallback);
}
