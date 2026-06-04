<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import { PREVIEW_LIMITS, type ToolView } from "../../../tool-views/tool-result-view";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "find" }> };
  let { view }: Props = $props();

  const preview = $derived(view.paths.slice(0, PREVIEW_LIMITS.LIST_PREVIEW));
</script>

{#if view.count === 0}
  <p class="note">No files found.</p>
{:else}
  <ul class="paths">
    {#each preview as path (path)}
      <li>{path}</li>
    {/each}
  </ul>
  {#if view.count > preview.length}
    <p class="note">Showing first {preview.length} of {view.count} files.</p>
  {/if}
{/if}

<style>
  .paths {
    margin: 0;
    list-style: none;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    line-height: 1.5;
    max-height: 22rem;
    overflow: auto;
  }

  .note {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
</style>
