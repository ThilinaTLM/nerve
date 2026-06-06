<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import { extname } from "../../../tool-views/lang";
  import type { ToolView } from "../../../tool-views/tool-result-view";
  import ToolOutputBlock from "./ToolOutputBlock.svelte";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "write" }>;
    expanded?: boolean;
    onOpenFile?: (path: string) => void;
  };
  let { view, expanded = false }: Props = $props();

  const language = $derived(extname(view.relPath));
</script>

{#if view.content !== undefined && view.content.length > 0}
  <ToolOutputBlock text={view.content} {language} {expanded} />
{/if}
