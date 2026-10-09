<script lang="ts">
import type { ToolCallDisplayRecord } from "../views/tool-result-view";
import { COLLAPSED_LINES, type ToolView } from "../views/tool-result-view";
import { getToolMotion, resultRowEnterDelay } from "./tool-motion-context";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "find" }>;
  expanded?: boolean;
  onOpenFile?: (path: string) => void;
};
let { toolCall, view, expanded = false, onOpenFile }: Props = $props();
const toolMotion = getToolMotion();

const visible = $derived(
  (expanded ? view.paths : view.paths.slice(0, COLLAPSED_LINES)).map(
    (path, index) => ({
      path,
      openPath: view.openPaths[index] ?? path,
    }),
  ),
);
</script>

{#if view.count === 0 && toolCall.state === "completed"}
  <p class="m-0 text-xs text-muted-foreground">No files found.</p>
{:else if view.count > 0}
  <ul
    class="m-0 list-none rounded-sm border bg-well px-2.5 py-2 font-mono text-xs leading-snug text-foreground"
  >
    {#each visible as item, index (item.path)}
      <li
        class:stream-item-enter={toolMotion.enter}
        style:--stream-item-delay={toolMotion.enter
          ? resultRowEnterDelay(index)
          : undefined}
      >
        <button
          type="button"
          class="cursor-pointer border-0 bg-transparent p-0 text-left font-mono text-xs text-primary hover:underline"
          onclick={() => onOpenFile?.(item.openPath)}>{item.path}</button
        >
      </li>
    {/each}
  </ul>
{/if}
