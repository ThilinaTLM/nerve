<script lang="ts">
import { retainConversationStore } from "$lib/features/conversations/state/open-conversation-stores";
import type { ConversationStore } from "$lib/features/conversations/state/core-conversation-store.svelte";
import { conversationContext } from "$lib/features/conversations/adapters/core-context.adapter";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";

/**
 * Context usage of one conversation as `ctx 34%`. It retains the
 * conversation's store only while mounted, so closed popovers cost nothing.
 */
let { conversationId }: { conversationId: string } = $props();

let store = $state<ConversationStore>();
$effect(() => {
  const retained = retainConversationStore(conversationId);
  store = retained.store;
  void retained.ready.catch(() => undefined);
  return () => {
    store = undefined;
    retained.release();
  };
});

const percent = $derived(
  store?.snapshot
    ? conversationContext(store.snapshot, store.events, settingsState.models)
        .contextUsage.percent
    : null,
);
</script>

{#if percent !== null}
  <span class="tabular-nums">ctx {Math.round(percent)}%</span>
{/if}
