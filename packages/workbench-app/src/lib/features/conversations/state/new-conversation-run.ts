import type { ConversationViewState } from "$lib/core/types/state-types";

export type NewConversationRunView = Pick<
  ConversationViewState,
  "sending" | "error" | "optimisticMessages"
>;

export type NewConversationRunOptions = {
  hydrate: () => Promise<void>;
  view: () => NewConversationRunView;
  optimisticMessages: ConversationViewState["optimisticMessages"];
  start: () => Promise<void>;
};

/**
 * Establish the snapshot/subscription boundary before the first run, then
 * restore the app-only optimistic projection that snapshot hydration clears.
 */
export async function startNewConversationRun(
  options: NewConversationRunOptions,
): Promise<void> {
  await options.hydrate();
  const view = options.view();
  view.sending = true;
  view.error = undefined;
  view.optimisticMessages = options.optimisticMessages;
  await options.start();
}
