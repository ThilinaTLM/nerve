<script lang="ts">
import type { ToolCallDisplayRecord } from "../../views/tool-result-view";
import { COLLAPSED_LINES, type ToolView } from "../../views/tool-result-view";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "find" }>;
  expanded?: boolean;
  onOpenFile?: (path: string) => void;
};
let { view, expanded = false, onOpenFile }: Props = $props();

const visible = $derived(
  (expanded ? view.paths : view.paths.slice(0, COLLAPSED_LINES)).map(
    (path, index) => ({
      path,
      openPath: view.openPaths[index] ?? path,
    }),
  ),
);
</script>

{#if view.count === 0}
  <p class="m-0 text-xs text-muted-foreground">No files found.</p>
{:else}
  <ul
    class="m-0 list-none rounded-sm border bg-sidebar px-2.5 py-2 font-mono text-xs leading-snug text-sidebar-foreground"
  >
    {#each visible as item (item.path)}
      <li>
        <button
          type="button"
          class="cursor-pointer border-0 bg-transparent p-0 text-left font-mono text-xs text-primary hover:underline"
          onclick={() => onOpenFile?.(item.openPath)}>{item.path}</button
        >
      </li>
    {/each}
  </ul>
{/if}
