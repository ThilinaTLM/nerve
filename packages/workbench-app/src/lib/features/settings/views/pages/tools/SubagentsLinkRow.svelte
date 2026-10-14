<script lang="ts">
import { openSettingsPane } from "$lib/application/settings";
import ToolConfigureButton from "./ToolConfigureButton.svelte";
import ToolGroupItem from "./ToolGroupItem.svelte";

const tools = [
  {
    name: "subagent_prompt",
    description: "Assign work to a sub-agent or follow up with one.",
  },
  {
    name: "subagent_status",
    description: "Check sub-agent progress and read final responses.",
  },
  { name: "subagent_stop", description: "Stop a running sub-agent." },
];
</script>

<ToolGroupItem
  title="Sub-agents"
  description="Delegate work to sub-agents with their own profiles."
  {tools}
>
  {#snippet actions()}
    <ToolConfigureButton
      label="Configure Sub-agents"
      onclick={() => void openSettingsPane("subagents")}
    />
  {/snippet}
</ToolGroupItem>
