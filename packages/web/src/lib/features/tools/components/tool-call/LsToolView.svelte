<script lang="ts">
  import FileIcon from "@lucide/svelte/icons/file";
  import Folder from "@lucide/svelte/icons/folder";
  import type { FileEntry } from "@nerve/shared";
  import type { ToolCallRecord } from "$lib/api";
  import { COLLAPSED_LINES, type ToolView } from "$lib/features/tools/views/tool-result-view";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "ls" }>;
    expanded?: boolean;
    onOpenFile?: (path: string) => void;
  };
  let { view, expanded = false, onOpenFile }: Props = $props();

  type FileEntryView = FileEntry & { openPath?: string };

  function sortEntries(entries: FileEntryView[]): FileEntryView[] {
    return [...entries].sort((a, b) => {
      if (a.kind === b.kind) return a.path.localeCompare(b.path);
      return a.kind === "directory" ? -1 : 1;
    });
  }

  const sorted = $derived(sortEntries(view.entries));
  const visible = $derived(expanded ? sorted : sorted.slice(0, COLLAPSED_LINES));
</script>

{#if view.total === 0}
  <p class="note">Empty directory.</p>
{:else}
  <ul class="entries">
    {#each visible as entry (entry.path)}
      <li>
        {#if entry.kind === "directory"}<Folder size={12} strokeWidth={2} />{:else}<FileIcon size={12} strokeWidth={2} />{/if}
        {#if entry.kind === "file"}
          <button type="button" onclick={() => onOpenFile?.(entry.openPath ?? entry.path)}>{entry.path}</button>
        {:else}
          <span>{entry.path}</span>
        {/if}
      </li>
    {/each}
  </ul>
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
    font-size: var(--text-xs);
    line-height: 1.45;
    overflow: visible;
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

  .entries button {
    border: 0;
    background: transparent;
    color: var(--primary);
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-align: left;
  }

  .entries button:hover {
    text-decoration: underline;
  }

  .note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
</style>
