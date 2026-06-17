export const workbenchUiState = $state({
  desktopQuitRequested: false,
  projectSearchFocusToken: 0,
  composerFocusToken: 0,
  composerEscapeToken: 0,
  micShortcutToken: 0,
  historyDialogOpen: false,
});

export function focusProjectSearch() {
  workbenchUiState.projectSearchFocusToken += 1;
}

export function focusComposer() {
  workbenchUiState.composerFocusToken += 1;
}

export function escapeComposer() {
  workbenchUiState.composerEscapeToken += 1;
}

export function toggleComposerMic() {
  workbenchUiState.micShortcutToken += 1;
}

export function openConversationHistory() {
  workbenchUiState.historyDialogOpen = true;
}
