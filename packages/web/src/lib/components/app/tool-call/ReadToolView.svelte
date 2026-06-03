<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import { extname } from "../../../tool-views/lang";
  import type { ToolView } from "../../../tool-views/tool-result-view";
  import ResultCodeBlock from "./ResultCodeBlock.svelte";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "read" }> };
  let { view }: Props = $props();

  const language = $derived(extname(view.relPath));
</script>

{#if view.image}
  <img class="read-thumb" src={view.image.dataUrl} alt={view.relPath ?? "image"} />
{:else if view.content !== undefined && view.content.length > 0}
  <ResultCodeBlock code={view.content} {language} />
  {#if view.truncated}
    <p class="note">Output truncated — open the file to read more.</p>
  {/if}
{/if}

<style>
  .read-thumb {
    max-width: 320px;
    max-height: 240px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    object-fit: contain;
  }

  .note {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
</style>
