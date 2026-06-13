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
  <button class="thumb-button" type="button" onclick={() => view.path && onOpenFile?.(view.path)} title="Open image pane">
    <img class="read-thumb" src={view.image.dataUrl} alt={view.relPath ?? "image"} />
  </button>
{:else if view.content !== undefined && view.content.length > 0}
  <ToolOutputBlock text={view.content} {language} {expanded} />
{/if}

<style>
  .thumb-button {
    border: 0;
    background: transparent;
    cursor: pointer;
    padding: 0;
  }

  .read-thumb {
    max-width: 320px;
    max-height: 240px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    object-fit: contain;
  }
</style>
