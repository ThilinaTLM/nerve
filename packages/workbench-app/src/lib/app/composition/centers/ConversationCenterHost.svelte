<script lang="ts">
import WorkbenchConversationHost from "$lib/app/composition/conversations/WorkbenchConversationHost.svelte";
import {
  workspaceState,
  type CenterTabIdentity,
} from "$lib/application/workspace/workspace-state.svelte";
let { tab, active = true }: { tab?: CenterTabIdentity; active?: boolean } =
  $props();
const paneTab = $derived(tab ?? workspaceState.activeCenterTab);
const conversationId = $derived(
  paneTab?.kind === "conversation" ? paneTab.id : undefined,
);
</script>
{#if conversationId}<WorkbenchConversationHost {conversationId} {active} />{/if}
