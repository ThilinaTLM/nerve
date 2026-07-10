<script lang="ts">
import type { ToolCallDisplayRecord } from "../../views/tool-result-view";
import {
  COLLAPSED_LINES,
  type GroupedMatches,
  type ToolView,
} from "../../views/tool-result-view";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "grep" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};
let { view, expanded = false, onOpenFile }: Props = $props();

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

{#snippet matchGroups(groups: GroupedMatches[])}
  <div class="matches">
    {#each groups as group (group.path)}
      <div class="file">
        <button
          class="file-path"
          type="button"
          onclick={() => onOpenFile?.(group.openPath ?? group.path)}
          title="Open file pane"
        >
          {group.path}
        </button>
        {#each group.matches as match, index (`${group.path}:${match.line}:${index}:${match.text}`)}
          <button
            class="match"
            type="button"
            onclick={() =>
              onOpenFile?.(
                match.openPath ?? group.openPath ?? group.path,
                match.line,
              )}
            title={`Open ${group.path}:${match.line}`}
          >
            <span class="line-no">{match.line}</span><span class="line-text"
              >{match.text}</span
            >
          </button>
        {/each}
      </div>
    {/each}
  </div>
{/snippet}

{#if view.matchCount === 0}
  <p class="note">No matches.</p>
{:else}
  {@render matchGroups(visibleGroups)}
{/if}

<style>
.matches {
  display: grid;
  gap: 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--sidebar);
  color: var(--sidebar-foreground);
  padding: 0.5rem 0.6rem;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.4;
  overflow: visible;
}

.file-path,
.match {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 0;
  text-align: left;
}

.file-path {
  color: var(--primary);
  font-weight: 600;
}

.file-path:hover,
.match:hover .line-text {
  text-decoration: underline;
}

.match {
  display: grid;
  grid-template-columns: 3rem minmax(0, 1fr);
  gap: 0.5rem;
  width: 100%;
}

.line-no {
  color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
  text-align: right;
}

.line-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--muted-foreground);
}
</style>
