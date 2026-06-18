<script lang="ts">
  import type { ToolCallRecord } from "$lib/api";
  import { extname } from "$lib/features/tools/views/lang";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";
  import ToolOutputBlock from "./ToolOutputBlock.svelte";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "read" }>;
    expanded?: boolean;
    onOpenFile?: (path: string, line?: number) => void;
  };
  let { view, expanded = false, onOpenFile }: Props = $props();

  const language = $derived(extname(view.relPath));
</script>

{#if view.image}
  <button class="cursor-pointer border-0 bg-transparent p-0" type="button" onclick={() => view.path && onOpenFile?.(view.path)} title="Open image pane">
    <img class="max-h-60 max-w-80 rounded-sm border object-contain" src={view.image.dataUrl} alt={view.relPath ?? "image"} />
  </button>
{:else if view.content !== undefined && view.content.length > 0}
  <ToolOutputBlock text={view.content} {language} {expanded} />
{/if}
