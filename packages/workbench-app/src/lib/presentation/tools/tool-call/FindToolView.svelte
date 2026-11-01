<script lang="ts">
import type { ToolCallDisplayRecord } from "../views/tool-result-view";
import { COLLAPSED_LINES, type ToolView } from "../views/tool-result-view";
import { getToolMotion, resultRowEnterDelay } from "./tool-motion-context";
import ToolSections from "./ToolSections.svelte";

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

{#if view.count === 0 && toolCall.status === "completed"}
  <ToolSections>
    <div class="px-2.5 py-2 text-ui text-muted-foreground">No files found.</div>
  </ToolSections>
{:else if view.count > 0}
  <ToolSections>
    <ul
      class="m-0 list-none px-2.5 py-2 font-mono text-ui leading-snug text-foreground"
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
            class="cursor-pointer border-0 bg-transparent p-0 text-left font-mono text-ui text-primary hover:text-foreground"
            onclick={() => onOpenFile?.(item.openPath)}>{item.path}</button
          >
        </li>
      {/each}
    </ul>
  </ToolSections>
{/if}
