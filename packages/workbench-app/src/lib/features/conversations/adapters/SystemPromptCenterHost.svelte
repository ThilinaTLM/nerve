<script lang="ts">
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import SystemPromptPane from "$lib/presentation/conversations/SystemPromptPane.svelte";
import {
  setSystemPromptPaneSection,
  systemPromptPanes,
} from "../state/system-prompt-pane.svelte";

const sourceId = $derived(
  workspaceState.activeCenterTab?.kind === "system-prompt"
    ? workspaceState.activeCenterTab.id
    : undefined,
);
const pane = $derived(sourceId ? systemPromptPanes.panes[sourceId] : undefined);
</script>

{#if sourceId && pane}
  <SystemPromptPane
    text={pane.text}
    tools={pane.tools}
    section={pane.section}
    onSectionChange={(section) => setSystemPromptPaneSection(sourceId, section)}
  />
{/if}
