<script lang="ts">
import type { ToolCallDisplayRecord } from "../views/tool-result-view";
import type { ToolView } from "../views/tool-result-view";
import ToolOutputBlock from "./ToolOutputBlock.svelte";
import ToolSections from "./ToolSections.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "web_fetch" }>;
  expanded?: boolean;
};
let { toolCall, view, expanded = false }: Props = $props();

const language = $derived(view.converted ? "markdown" : undefined);
</script>

<ToolSections>
  {#if view.content !== undefined && view.content.length > 0}
    <div class="px-2.5 py-2">
      <ToolOutputBlock text={view.content} {language} {expanded} />
    </div>
  {:else if toolCall.status === "completed"}
    <p class="m-0 px-2.5 py-2 text-ui text-muted-foreground">No content.</p>
  {/if}
</ToolSections>
