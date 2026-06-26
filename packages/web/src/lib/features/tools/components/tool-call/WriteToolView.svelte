<script lang="ts">
  import type { ToolCallDisplayRecord } from "$lib/features/tools/views/tool-result-view";
  import { extname } from "$lib/features/tools/views/lang";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";
  import ToolOutputBlock from "./ToolOutputBlock.svelte";

  type Props = {
    toolCall: ToolCallDisplayRecord;
    view: Extract<ToolView, { kind: "write" }>;
    expanded?: boolean;
    onOpenFile?: (path: string) => void;
  };
  let { view, expanded = false }: Props = $props();

  const language = $derived(extname(view.relPath));
</script>

{#if view.content !== undefined && view.content.length > 0}
  <ToolOutputBlock text={view.content} {language} direction="tail" {expanded} />
{/if}
