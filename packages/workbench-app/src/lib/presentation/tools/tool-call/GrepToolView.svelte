<script lang="ts">
import type { ToolCallDisplayRecord } from "../views/tool-result-view";
import { getToolMotion, resultRowEnterDelay } from "./tool-motion-context";
import {
  COLLAPSED_LINES,
  type GroupedMatches,
  type ToolView,
} from "../views/tool-result-view";
import ToolSections from "./ToolSections.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "grep" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};
let { toolCall, view, expanded = false, onOpenFile }: Props = $props();
const toolMotion = getToolMotion();

const visibleGroups = $derived.by(() => {
  if (expanded) return view.allMatches;
  const groups: GroupedMatches[] = [];
  let shown = 0;
  for (const group of view.allMatches) {
    if (shown >= COLLAPSED_LINES) break;
    const slice = group.matches.slice(0, COLLAPSED_LINES - shown);
    groups.push({ path: group.path, openPath: group.openPath, matches: slice });
    shown += slice.length;
  }
  return groups;
});
</script>

{#if view.matchCount === 0 && toolCall.status === "completed"}
  <ToolSections>
    <div class="px-2.5 py-2 text-xs text-muted-foreground">No matches.</div>
  </ToolSections>
{:else if view.matchCount > 0}
  <!-- One sheet section per file: its path, then its matching lines. -->
  <ToolSections>
    {#each visibleGroups as group, groupIndex (group.path)}
      <div
        class="px-2.5 py-2 font-mono text-xs leading-[1.4]"
        class:stream-item-enter={toolMotion.enter}
        style:--stream-item-delay={toolMotion.enter
          ? resultRowEnterDelay(groupIndex)
          : undefined}
      >
        <button
          class="cursor-pointer border-0 bg-transparent p-0 text-left font-semibold text-primary hover:underline"
          type="button"
          onclick={() => onOpenFile?.(group.openPath ?? group.path)}
          title="Open file pane"
        >
          {group.path}
        </button>
        {#each group.matches as match, index (`${group.path}:${match.line}:${index}:${match.text}`)}
          <button
            class="group grid w-full cursor-pointer grid-cols-[3rem_minmax(0,1fr)] gap-2 border-0 bg-transparent p-0 text-left"
            type="button"
            onclick={() =>
              onOpenFile?.(
                match.openPath ?? group.openPath ?? group.path,
                match.line,
              )}
            title={`Open ${group.path}:${match.line}`}
          >
            <span class="text-right text-muted-foreground/75">{match.line}</span
            ><span
              class="break-words whitespace-pre-wrap text-foreground group-hover:underline"
              >{match.text}</span
            >
          </button>
        {/each}
      </div>
    {/each}
  </ToolSections>
{/if}
