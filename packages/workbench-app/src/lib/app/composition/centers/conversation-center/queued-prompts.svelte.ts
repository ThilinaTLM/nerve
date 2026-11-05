import { focusComposer } from "$lib/features/conversations/state/composer-signals.svelte";
import type { ConversationStore } from "$lib/features/conversations/state/core-conversation-store.svelte";
import type { QueuedPromptRecord } from "$lib/presentation/view-models/conversation";

/** Actions on the viewed conversation's queued prompts. */
export function createQueuedPromptActions(deps: {
  store: () => ConversationStore | undefined;
  setComposerText: (text: string) => void;
}) {
  return {
    forcePushQueuedPrompts() {
      return deps
        .store()
        ?.control("forcePush")
        .then(() => undefined);
    },
    discardQueuedPrompt(prompt: QueuedPromptRecord) {
      return deps
        .store()
        ?.cancelInput(prompt.id)
        .then(() => undefined);
    },
    async moveQueuedPromptToComposer(prompt: QueuedPromptRecord) {
      const text = await deps.store()?.moveInputToComposer(prompt.id);
      if (text !== undefined) {
        deps.setComposerText(text);
        focusComposer();
      }
    },
  };
}
