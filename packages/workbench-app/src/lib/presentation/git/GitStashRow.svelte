<script lang="ts">
import ArchiveRestore from "@lucide/svelte/icons/archive-restore";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { GitStashEntry } from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { ItemSurface } from "$lib/presentation/items";
import type { StashMutation } from "./git-panel-types";

type Props = {
  stash: GitStashEntry;
  busy: boolean;
  mutation?: StashMutation;
  onApply: (stash: GitStashEntry) => void;
  onDrop: (stash: GitStashEntry) => void;
};

let { stash, busy, mutation, onApply, onDrop }: Props = $props();
</script>

<ItemSurface
  role="listitem"
  hover="soft"
  focusWithin
  class="flex-col gap-1 px-3 py-2.5"
>
  <div class="flex min-w-0 items-center gap-2">
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span
        class="line-clamp-2 text-xs font-medium leading-snug break-words text-foreground"
        title={stash.message}>{stash.message}</span
      >
      <span class="truncate text-xs text-muted-foreground">
        <span class="font-mono">{stash.ref}</span>
        <span aria-hidden="true"> · </span>
        <span class="font-mono">{stash.hash.slice(0, 8)}</span>
        <span aria-hidden="true"> · </span>
        {stash.relativeDate}
      </span>
    </div>
    <Button
      size="xs"
      variant="outline"
      disabled={busy}
      onclick={() => onApply(stash)}
    >
      {#if mutation?.action === "apply" && mutation.hash === stash.hash}
        <Spinner class="size-3" />
      {:else}
        <ArchiveRestore />
      {/if}
      Apply
    </Button>
    <Button
      size="icon-xs"
      variant="ghost"
      class="text-destructive hover:bg-destructive/10 hover:text-destructive"
      aria-label={`Drop ${stash.ref}`}
      title="Drop stash"
      disabled={busy}
      onclick={() => onDrop(stash)}
    >
      {#if mutation?.action === "drop" && mutation.hash === stash.hash}
        <Spinner class="size-3" />
      {:else}
        <Trash2 />
      {/if}
    </Button>
  </div>
</ItemSurface>
