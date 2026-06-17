export const selection = $state({
  projectId: undefined as string | undefined,
  conversationId: undefined as string | undefined,
  agentId: undefined as string | undefined,
  entryId: undefined as string | undefined,
});

export const eventBuffer = $state({
  items: [] as string[],
});

export const composerDraft = $state({
  text: "",
  projectDir: "",
});

export function pushEventPreview(serialized: string) {
  eventBuffer.items = [serialized, ...eventBuffer.items].slice(0, 16);
}

export function resetSelection() {
  selection.projectId = undefined;
  selection.conversationId = undefined;
  selection.agentId = undefined;
  selection.entryId = undefined;
}
