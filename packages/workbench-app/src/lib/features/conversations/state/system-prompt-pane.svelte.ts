import type { PreviewToolDefinition } from "@nervekit/contracts/core";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import type { RequestPreviewSection } from "$lib/presentation/conversations/request-preview";

export type SystemPromptPaneSnapshot = {
  projectId: string;
  text: string;
  /** Absent when the preview was unavailable; `text` then explains why. */
  tools?: PreviewToolDefinition[];
  section: RequestPreviewSection;
};

export type SystemPromptPaneInput = SystemPromptPaneSnapshot & {
  /** Persisted conversation id or pending conversation id. */
  sourceId: string;
};

/**
 * In-memory next-request snapshots keyed by source. Content is never
 * persisted: the tab identity carries only the source id, and restored
 * sessions drop the tab.
 */
export const systemPromptPanes = $state({
  panes: {} as Record<string, SystemPromptPaneSnapshot>,
});

/** Show a freshly fetched snapshot, replacing any earlier content for the source. */
export async function openSystemPromptPane(
  input: SystemPromptPaneInput,
): Promise<void> {
  if (input.projectId !== workspaceState.selectedProjectId) {
    const { selectProject } =
      await import("$lib/application/workspace/workspace-actions.svelte");
    await selectProject(input.projectId);
  }
  const { sourceId, ...snapshot } = input;
  systemPromptPanes.panes[sourceId] = snapshot;
  const { addCenterTab, setActiveCenterTab } =
    await import("$lib/application/workspace/center-tabs.svelte");
  const tab = { kind: "system-prompt" as const, id: sourceId };
  addCenterTab(tab);
  setActiveCenterTab(tab);
}

export function setSystemPromptPaneSection(
  sourceId: string,
  section: RequestPreviewSection,
): void {
  const pane = systemPromptPanes.panes[sourceId];
  if (pane) pane.section = section;
}

export function discardSystemPromptPane(sourceId: string): void {
  delete systemPromptPanes.panes[sourceId];
}
