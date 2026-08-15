export const conversationContextState = $state({
  selectedAgentId: undefined as string | undefined,
});

export const composerDraft = $state({
  text: "",
  projectDir: "",
});

export function resetConversationContext(): void {
  conversationContextState.selectedAgentId = undefined;
}
