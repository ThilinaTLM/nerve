import type { ConversationViewState } from "./conversation-state.svelte";

export type OptimisticPromptView = Pick<
  ConversationViewState,
  "composerText" | "optimisticMessages"
>;

export type OptimisticPromptTransaction = {
  readonly previousMessages: ConversationViewState["optimisticMessages"];
  readonly submittedText: string;
};

export function beginOptimisticPrompt(
  view: OptimisticPromptView,
  submittedText: string,
  optimisticMessage: ConversationViewState["optimisticMessages"][number],
): OptimisticPromptTransaction {
  const transaction = {
    previousMessages: view.optimisticMessages,
    submittedText,
  };
  view.optimisticMessages = [...view.optimisticMessages, optimisticMessage];
  return transaction;
}

export function rollbackOptimisticPrompt(
  view: OptimisticPromptView,
  transaction: OptimisticPromptTransaction,
): void {
  view.optimisticMessages = transaction.previousMessages;
  if (!view.composerText.trim()) {
    view.composerText = transaction.submittedText;
  }
}
