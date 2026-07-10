<script lang="ts">
import type { ToolCallDisplayRecord } from "../../views/tool-result-view";
import type { ToolView } from "../../views/tool-result-view";
import ToolOutputBlock from "./ToolOutputBlock.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "web_fetch" }>;
  expanded?: boolean;
};
let { view, expanded = false }: Props = $props();

const language = $derived(view.converted ? "markdown" : undefined);
</script>

{#if view.content !== undefined && view.content.length > 0}
  <ToolOutputBlock text={view.content} {language} {expanded} />
{/if}
