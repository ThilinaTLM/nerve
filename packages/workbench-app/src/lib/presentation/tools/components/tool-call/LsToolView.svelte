<script lang="ts">
import FileIcon from "@lucide/svelte/icons/file";
import Folder from "@lucide/svelte/icons/folder";
import type { FileEntry } from "@nervekit/contracts";
import type { ToolCallDisplayRecord } from "../../views/tool-result-view";
import { COLLAPSED_LINES, type ToolView } from "../../views/tool-result-view";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "ls" }>;
  expanded?: boolean;
  onOpenFile?: (path: string) => void;
};
let { toolCall, view, expanded = false, onOpenFile }: Props = $props();

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

{#if view.total === 0 && toolCall.status === "completed"}
  <p class="m-0 text-xs text-muted-foreground">Empty directory.</p>
{:else if view.total > 0}
  <ul
    class="m-0 list-none rounded-sm border bg-sidebar px-2.5 py-2 font-mono text-xs leading-normal text-sidebar-foreground"
  >
    {#each visible as entry (entry.path)}
      <li class="flex items-center gap-1.5">
        {#if entry.kind === "directory"}<Folder
            size={12}
            strokeWidth={2}
            class="flex-none text-muted-foreground"
          />{:else}<FileIcon
            size={12}
            strokeWidth={2}
            class="flex-none text-muted-foreground"
          />{/if}
        {#if entry.kind === "file"}
          <button
            type="button"
            class="cursor-pointer border-0 bg-transparent p-0 text-left font-mono text-xs text-primary hover:underline"
            onclick={() => onOpenFile?.(entry.openPath ?? entry.path)}
            >{entry.path}</button
          >
        {:else}
          <span>{entry.path}</span>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
