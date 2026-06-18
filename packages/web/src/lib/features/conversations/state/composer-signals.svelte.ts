// Cross-component composer signals. Shortcut handlers (registered at the app
// level) bump these tokens; the composer/shell components watch them to focus,
// reset, or toggle the mic without the app layer holding refs into the tree.
export const composerSignals = $state({
  focusToken: 0,
  escapeToken: 0,
  micToken: 0,
  historyDialogOpen: false,
});

export function focusComposer(): void {
  composerSignals.focusToken += 1;
}

export function escapeComposer(): void {
  composerSignals.escapeToken += 1;
}

export function toggleComposerMic(): void {
  composerSignals.micToken += 1;
}

export function openConversationHistory(): void {
  composerSignals.historyDialogOpen = true;
}
