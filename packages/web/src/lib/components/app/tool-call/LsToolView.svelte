<script lang="ts">
  import Folder from "@lucide/svelte/icons/folder";
  import FileIcon from "@lucide/svelte/icons/file";
  import type { ToolCallRecord } from "../../../api";
  import type { FileEntry } from "@nerve/shared";
  import { PREVIEW_LIMITS, type ToolView } from "../../../tool-views/tool-result-view";
  import Disclosure from "./Disclosure.svelte";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "ls" }> };
  let { view }: Props = $props();

  function sortEntries(entries: FileEntry[]): FileEntry[] {
    return [...entries].sort((a, b) => {
      if (a.kind === b.kind) return a.path.localeCompare(b.path);
      return a.kind === "directory" ? -1 : 1;
    });
  }

  const sorted = $derived(sortEntries(view.entries));
  const preview = $derived(sorted.slice(0, PREVIEW_LIMITS.LS_PREVIEW));
</script>

{#snippet entryList(entries: FileEntry[])}
  <ul class="entries">
    {#each entries as entry (entry.path)}
      <li>
        {#if entry.kind === "directory"}<Folder size={12} strokeWidth={2} />{:else}<FileIcon size={12} strokeWidth={2} />{/if}
        <span>{entry.path}</span>
      </li>
    {/each}
  </ul>
{/snippet}

{#if view.total === 0}
  <p class="note">Empty directory.</p>
{:else}
  {@render entryList(preview)}
  {#if view.total > preview.length}
    <Disclosure label={`all ${view.total} entries`}>
      {@render entryList(sorted)}
    </Disclosure>
  {/if}
{/if}

<style>
  .entries {
    margin: 0;
    list-style: none;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    line-height: 1.6;
    max-height: 22rem;
    overflow: auto;
  }

  .entries li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .entries li :global(svg) {
    color: var(--muted-foreground);
    flex: none;
  }

  .note {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
</style>
