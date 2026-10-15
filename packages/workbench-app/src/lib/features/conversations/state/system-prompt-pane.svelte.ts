import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";

export type SystemPromptPaneInput = {
  projectId: string;
  /** Persisted conversation id or pending conversation id. */
  sourceId: string;
  text: string;
};

/**
 * In-memory prompt snapshots keyed by source. Text is never persisted: the tab
 * identity carries only the source id, and restored sessions drop the tab.
 */
export const systemPromptPanes = $state({
  panes: {} as Record<string, { projectId: string; text: string }>,
});

/** Show a freshly fetched snapshot, replacing any earlier text for the source. */
export async function openSystemPromptPane(
  input: SystemPromptPaneInput,
): Promise<void> {
  if (input.projectId !== workspaceState.selectedProjectId) {
    const { selectProject } =
      await import("$lib/application/workspace/workspace-actions.svelte");
    await selectProject(input.projectId);
  }
  systemPromptPanes.panes[input.sourceId] = {
    projectId: input.projectId,
    text: input.text,
  };
  const { addCenterTab, setActiveCenterTab } =
    await import("$lib/application/workspace/center-tabs.svelte");
  const tab = { kind: "system-prompt" as const, id: input.sourceId };
  addCenterTab(tab);
  setActiveCenterTab(tab);
}

export function discardSystemPromptPane(sourceId: string): void {
  delete systemPromptPanes.panes[sourceId];
}
