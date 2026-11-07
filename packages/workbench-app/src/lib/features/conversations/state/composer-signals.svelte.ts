import type { ConversationEntry } from "$lib/presentation/view-models/conversation";
// Cross-component composer signals. Shortcut handlers (registered at the app
// level) bump these tokens; the composer/shell components watch them to focus,
// reset, or toggle the mic without the app layer holding refs into the tree.
export const composerSignals = $state({
  editEntry: undefined as ConversationEntry | undefined,
  focusToken: 0,
  escapeToken: 0,
  micToken: 0,
  /** Requests for the visible conversation pane's History view. */
  historyRequest: { token: 0, mode: "toggle" as "open" | "close" | "toggle" },
  /** Previous/next message requests for the visible transcript. */
  messageStep: { token: 0, direction: 1 as -1 | 1 },
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

function requestHistory(mode: "open" | "close" | "toggle"): void {
  composerSignals.historyRequest = {
    token: composerSignals.historyRequest.token + 1,
    mode,
  };
}

export function openConversationHistory(): void {
  requestHistory("open");
}

export function closeConversationHistory(): void {
  requestHistory("close");
}

export function toggleConversationHistory(): void {
  requestHistory("toggle");
}

export function stepConversationMessage(direction: -1 | 1): void {
  composerSignals.messageStep = {
    token: composerSignals.messageStep.token + 1,
    direction,
  };
}
