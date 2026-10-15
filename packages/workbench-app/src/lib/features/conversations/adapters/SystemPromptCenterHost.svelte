<script lang="ts">
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import SystemPromptPane from "$lib/presentation/conversations/SystemPromptPane.svelte";
import { systemPromptPanes } from "../state/system-prompt-pane.svelte";

const sourceId = $derived(
  workspaceState.activeCenterTab?.kind === "system-prompt"
    ? workspaceState.activeCenterTab.id
    : undefined,
);
const text = $derived(
  sourceId ? systemPromptPanes.panes[sourceId]?.text : undefined,
);
</script>

{#if text !== undefined}
  <SystemPromptPane {text} />
{/if}
