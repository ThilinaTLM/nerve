<script lang="ts">
import type { GitStashEntry } from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { ItemScrollRegion } from "$lib/presentation/items";
import GitStashRow from "./GitStashRow.svelte";
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
  flush
  title="Stashes"
  description={`Saved changes for ${repositoryName}`}
  size="md"
>
  {#if stashes.length === 0}
    <p class="p-8 text-center text-sm text-muted-foreground">
      No stashes in this repository.
    </p>
  {:else}
    <div class="flex max-h-80 min-h-0 flex-col p-1.5">
      <ItemScrollRegion
        ariaLabel="Stashes"
        contentClass="flex min-w-0 shrink-0 flex-col gap-1.5 py-0.5"
      >
        {#each stashes.slice(0, 100) as stash (stash.hash)}
          <GitStashRow
            {stash}
            {busy}
            {mutation}
            {onApply}
            onDrop={(candidate) => (dropCandidate = candidate)}
          />
        {/each}
      </ItemScrollRegion>
    </div>
    {#if stashes.length > 100}
      <p class="px-3 pb-2 text-xs text-muted-foreground">
        Showing the first 100 of {stashes.length} stashes.
      </p>
    {/if}
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
