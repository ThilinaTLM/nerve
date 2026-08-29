<script lang="ts">
import type { GitStashEntry } from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
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

function confirmDrop(): void {
  const candidate = dropCandidate;
  if (!candidate) return;
  dropCandidate = undefined;
  onDrop(candidate);
}
</script>

<Dialog
  bind:open
  flush
  title={dropCandidate ? "Drop stash?" : "Stashes"}
  description={dropCandidate
    ? "This action cannot be undone."
    : `Saved changes for ${repositoryName}`}
  size="md"
  onOpenChange={(next) => {
    if (!next) dropCandidate = undefined;
  }}
>
  {#if dropCandidate}
    <p class="p-4 text-sm text-muted-foreground">
      This permanently removes
      <span class="font-mono text-foreground">{dropCandidate.ref}</span>:
      {dropCandidate.message}
    </p>
  {:else if stashes.length === 0}
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
    {#if dropCandidate}
      <Button
        size="sm"
        variant="ghost"
        onclick={() => (dropCandidate = undefined)}>Cancel</Button
      >
      <Button size="sm" variant="destructive" onclick={confirmDrop}
        >Drop stash</Button
      >
    {:else}
      <Button size="sm" variant="ghost" onclick={() => (open = false)}>
        Close
      </Button>
    {/if}
  {/snippet}
</Dialog>
