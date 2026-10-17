export const selection = $state({
  projectId: undefined as string | undefined,
  conversationId: undefined as string | undefined,
});

export function resetSelection() {
  selection.projectId = undefined;
  selection.conversationId = undefined;
}
