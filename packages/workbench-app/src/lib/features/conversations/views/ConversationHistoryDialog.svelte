<script lang="ts">
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import type { ConversationStore } from "../state/core-conversation-store.svelte";
import type { EventTreeNode } from "@nervekit/contracts/core";
import ConversationHistoryGraph from "./ConversationHistoryGraph.svelte";
let {
  open = $bindable(false),
  store,
}: { open?: boolean; store: ConversationStore } = $props();
let tree = $state<EventTreeNode[]>([]);
let error = $state<string>();
$effect(() => {
  if (!open) return;
  let current = true;
  error = undefined;
  void store
    .tree()
    .then((value) => {
      if (current) tree = value;
    })
    .catch((e) => {
      if (current) error = String(e);
    });
  return () => {
    current = false;
  };
});
async function select(id: string | null) {
  try {
    await store.selectHead(id);
    open = false;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
}
</script>
<DialogShell
  bind:open
  title="Conversation history"
  description="Select an event to continue from that branch."
  class="max-w-5xl"
>
  <div class="h-96">
    <ConversationHistoryGraph
      treeNodes={tree}
      headEventId={store.snapshot?.conversation.headEventId}
      disabled={Boolean(store.snapshot?.toolCalls.length) ||
        store.snapshot?.conversation.status === "running" ||
        store.snapshot?.conversation.status === "waiting"}
      onSelect={select}
    />
  </div>
  {#if error}<p class="text-xs text-destructive" role="alert">{error}</p>{/if}
</DialogShell>
