<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import type { GroupedMatches, ToolView } from "../../../tool-views/tool-result-view";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "grep" }>;
    onOpenFile?: (path: string, line?: number) => void;
  };
  let { view, onOpenFile }: Props = $props();

  const shownMatches = $derived(view.previewMatches.reduce((sum, group) => sum + group.matches.length, 0));
</script>

{#snippet matchGroups(groups: GroupedMatches[])}
  <div class="matches">
    {#each groups as group (group.path)}
      <div class="file">
        <button class="file-path" type="button" onclick={() => onOpenFile?.(group.openPath ?? group.path)} title="Open file pane">
          {group.path}
        </button>
        {#each group.matches as match (`${group.path}:${match.line}:${match.text}`)}
          <button class="match" type="button" onclick={() => onOpenFile?.(match.openPath ?? group.openPath ?? group.path, match.line)} title={`Open ${group.path}:${match.line}`}>
            <span class="line-no">{match.line}</span><span class="line-text">{match.text}</span>
          </button>
        {/each}
      </div>
    {/each}
  </div>
{/snippet}

{#if view.matchCount === 0}
  <p class="note">No matches.</p>
{:else}
  {@render matchGroups(view.previewMatches)}
  {#if view.matchCount > shownMatches}
    <p class="note">Showing first {shownMatches} of {view.matchCount} matches.</p>
  {/if}
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
