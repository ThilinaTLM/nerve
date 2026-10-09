<script lang="ts">
import {
  ConversationContextPanel,
  retainConversationStore,
  type ConversationStore,
} from "$lib/features/conversations";
import { selection } from "$lib/application/workspace/selection.svelte";
let store = $state<ConversationStore>();
$effect(() => {
  const id = selection.conversationId;
  if (!id) {
    store = undefined;
    return;
  }
  const retained = retainConversationStore(id);
  store = retained.store;
  void retained.ready.catch(() => undefined);
  return retained.release;
});
</script>
<ConversationContextPanel {store} />
