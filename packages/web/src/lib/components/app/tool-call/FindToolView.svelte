<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import { COLLAPSED_LINES, type ToolView } from "../../../tool-views/tool-result-view";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "find" }>;
    expanded?: boolean;
    onOpenFile?: (path: string) => void;
  };
  let { view, expanded = false, onOpenFile }: Props = $props();

  const visible = $derived(
    (expanded ? view.paths : view.paths.slice(0, COLLAPSED_LINES)).map((path, index) => ({
      path,
      openPath: view.openPaths[index] ?? path,
    })),
  );
</script>

{#if view.count === 0}
  <p class="note">No files found.</p>
{:else}
  <ul class="paths">
    {#each visible as item (item.path)}
      <li><button type="button" onclick={() => onOpenFile?.(item.openPath)}>{item.path}</button></li>
    {/each}
  </ul>
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
    font-size: var(--text-xs);
    line-height: 1.4;
    overflow: visible;
  }

  .paths button {
    border: 0;
    background: transparent;
    color: var(--primary);
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-align: left;
  }

  .paths button:hover {
    text-decoration: underline;
  }

  .note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
</style>
