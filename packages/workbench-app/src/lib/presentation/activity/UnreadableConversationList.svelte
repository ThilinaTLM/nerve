<!--
  Conversations whose stored data could not be loaded, grouped by project.
  When every entry failed the same way the notification shows that error once,
  so rows only carry their own error when they differ.
-->
<script lang="ts">
import Trash2 from "@lucide/svelte/icons/trash-2";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  groupUnreadableConversations,
  type UnreadableConversationEntry,
} from "./notifications";

let {
  entries,
  onDelete,
}: {
  entries: UnreadableConversationEntry[];
  onDelete?: (entries: UnreadableConversationEntry[]) => void;
} = $props();

const grouped = $derived(groupUnreadableConversations(entries));
</script>

<div class="mt-1 grid gap-2 border-l pl-2">
  {#each grouped.groups as group (group.key)}
    <section class="grid" aria-label={group.projectName}>
      <h3 class="flex items-center gap-1 py-0.5 text-xs text-muted-foreground">
        <span class="min-w-0 truncate font-medium">{group.projectName}</span>
        <span class="tabular-nums">· {group.entries.length}</span>
      </h3>
      <ul class="grid">
        {#each group.entries as entry (entry.id)}
          <li class="flex min-w-0 items-center gap-1">
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs" title={entry.title || entry.id}>
                {entry.title || entry.id}
              </p>
              {#if !grouped.sharedError}
                <p
                  class="truncate text-xs text-destructive"
                  title={entry.error}
                >
                  {entry.error}
                </p>
              {/if}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground hover:text-destructive"
              ariaLabel={`Delete ${entry.title || entry.id}`}
              onclick={() => onDelete?.([entry])}
              ><Trash2 aria-hidden="true" /></Button
            >
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>
