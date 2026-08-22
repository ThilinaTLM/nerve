export const selection = $state({
  projectId: undefined as string | undefined,
  conversationId: undefined as string | undefined,
  agentId: undefined as string | undefined,
  entryId: undefined as string | undefined,
});

export const composerDraft = $state({
  text: "",
  projectDir: "",
});

export function resetSelection() {
  selection.projectId = undefined;
  selection.conversationId = undefined;
  selection.agentId = undefined;
  selection.entryId = undefined;
}
