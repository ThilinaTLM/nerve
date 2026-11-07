<script lang="ts">
import { untrack, type ComponentProps } from "svelte";
import { conversationView } from "$lib/features/conversations/adapters/core-context.adapter";
import { committedTranscript } from "$lib/features/conversations/adapters/core-transcript.adapter";
import type { ConversationStore } from "$lib/features/conversations/state/core-conversation-store.svelte";
import ConversationHistoryView from "$lib/features/conversations/views/ConversationHistoryView.svelte";

type Props = Omit<
  ComponentProps<typeof ConversationHistoryView>,
  "treeNodes" | "toolCalls" | "activeEntryId" | "loading"
> & { store: ConversationStore };

let { store, ...view }: Props = $props();

let loading = $state(true);
// Load every branch once per store; untracked, because loading rewrites the
// events it reads and would otherwise restart itself.
$effect(() => {
  const target = store;
  loading = true;
  untrack(() => target.loadHistoryTree())
    .catch(() => undefined)
    .finally(() => {
      if (target === store) loading = false;
    });
});

// New events append to the loaded history, so the view follows a running
// conversation.
const projection = $derived(
  store.snapshot
    ? committedTranscript({
        snapshot: store.snapshot,
        events: store.historyEvents ?? store.events,
      })
    : undefined,
);
const activeEntryId = $derived(
  store.snapshot ? conversationView(store.snapshot).activeEntryId : undefined,
);
</script>

<ConversationHistoryView
  {...view}
  treeNodes={projection?.treeNodes ?? []}
  toolCalls={projection?.toolCalls ?? []}
  {activeEntryId}
  {loading}
/>
