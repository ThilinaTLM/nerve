<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import type { GroupedMatches, ToolView } from "../../../tool-views/tool-result-view";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "grep" }> };
  let { view }: Props = $props();

  const shownMatches = $derived(view.previewMatches.reduce((sum, group) => sum + group.matches.length, 0));
</script>

{#snippet matchGroups(groups: GroupedMatches[])}
  <div class="matches">
    {#each groups as group (group.path)}
      <div class="file">
        <span class="file-path">{group.path}</span>
        {#each group.matches as match (`${group.path}:${match.line}:${match.text}`)}
          <div class="match"><span class="line-no">{match.line}</span><span class="line-text">{match.text}</span></div>
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
    font-size: 0.6875rem;
    line-height: 1.4;
    overflow: visible;
  }

  .file-path {
    color: var(--muted-foreground);
    font-weight: 600;
  }

  .match {
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr);
    gap: 0.5rem;
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
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
</style>
