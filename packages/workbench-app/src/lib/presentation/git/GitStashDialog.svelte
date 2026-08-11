<script lang="ts">
import ArchiveRestore from "@lucide/svelte/icons/archive-restore";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { GitStashEntry } from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import type { StashMutation } from "./git-panel-types";

type Props = {
  open?: boolean;
  repositoryName: string;
  stashes: readonly GitStashEntry[];
  mutation?: StashMutation;
  onApply: (stash: GitStashEntry) => void;
  onDrop: (stash: GitStashEntry) => void;
};

let {
  open = $bindable(false),
  repositoryName,
  stashes,
  mutation,
  onApply,
  onDrop,
}: Props = $props();

let dropCandidate = $state<GitStashEntry>();
const busy = $derived(Boolean(mutation));
</script>

<Dialog
  bind:open
  title="Stashes"
  description={`Saved changes for ${repositoryName}`}
  size="sm"
>
  {#if stashes.length === 0}
    <p class="py-4 text-center text-sm text-muted-foreground">
      No stashes in this repository.
    </p>
  {:else}
    <div class="max-h-80 overflow-y-auto rounded-md border">
      {#each stashes as stash (stash.hash)}
        <div
          class="flex min-w-0 items-center gap-2 border-b px-3 py-2 last:border-b-0"
        >
          <ArchiveRestore
            class="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="truncate text-xs font-medium text-foreground"
              >{stash.message}</span
            >
            <span class="truncate text-xs text-muted-foreground">
              <span class="font-mono">{stash.ref}</span>
              · <span class="font-mono">{stash.hash.slice(0, 8)}</span>
              · {stash.relativeDate}
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
            onclick={() => (dropCandidate = stash)}
          >
            {#if mutation?.action === "drop" && mutation.hash === stash.hash}
              <Spinner class="size-3" />
            {:else}
              <Trash2 />
            {/if}
          </Button>
        </div>
      {/each}
    </div>
  {/if}

  {#snippet footer()}
    <Button size="sm" variant="ghost" onclick={() => (open = false)}>
      Close
    </Button>
  {/snippet}
</Dialog>

<ConfirmDialog
  open={Boolean(dropCandidate)}
  title="Drop stash?"
  description={dropCandidate
    ? `This permanently removes ${dropCandidate.ref}: ${dropCandidate.message}`
    : "This permanently removes the selected stash."}
  confirmLabel="Drop stash"
  destructive
  onConfirm={() => {
    const candidate = dropCandidate;
    dropCandidate = undefined;
    if (candidate) onDrop(candidate);
  }}
  onCancel={() => (dropCandidate = undefined)}
  onOpenChange={(next) => {
    if (!next) dropCandidate = undefined;
  }}
/>
