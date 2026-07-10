<script lang="ts">
  import type { ToolCallDisplayRecord } from "../../views/tool-result-view";
  import type { ToolView } from "../../views/tool-result-view";
  import ToolOutputBlock from "./ToolOutputBlock.svelte";

  type Props = {
    toolCall: ToolCallDisplayRecord;
    view: Extract<ToolView, { kind: "edit" }>;
    expanded?: boolean;
    onOpenFile?: (path: string) => void;
  };
  let { view, expanded = false }: Props = $props();
</script>

{#if view.diff}
  <ToolOutputBlock text={view.diff} language="diff" direction="tail" {expanded} />
{/if}
