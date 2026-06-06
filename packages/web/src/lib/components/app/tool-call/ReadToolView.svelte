<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import { extname } from "../../../tool-views/lang";
  import type { ToolView } from "../../../tool-views/tool-result-view";
  import ResultCodeBlock from "./ResultCodeBlock.svelte";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "read" }>;
    onOpenFile?: (path: string, line?: number) => void;
  };
  let { view, onOpenFile }: Props = $props();

  const language = $derived(extname(view.relPath));
</script>

{#if view.image}
  <button class="thumb-button" type="button" onclick={() => view.path && onOpenFile?.(view.path)} title="Open image pane">
    <img class="read-thumb" src={view.image.dataUrl} alt={view.relPath ?? "image"} />
  </button>
{:else if view.content !== undefined && view.content.length > 0}
  <ResultCodeBlock code={view.content} {language} />
  {#if view.truncated}
    <p class="note">
      Output truncated
      {#if view.path}
        — <button type="button" onclick={() => onOpenFile?.(view.path!)}>open the file</button> to read more.
      {:else}
        — open the file to read more.
      {/if}
    </p>
  {/if}
{/if}

<style>
  .note button {
    border: 0;
    background: transparent;
    color: var(--primary);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 0;
    text-align: left;
  }

  .note button:hover {
    text-decoration: underline;
  }

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

  .note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
</style>
