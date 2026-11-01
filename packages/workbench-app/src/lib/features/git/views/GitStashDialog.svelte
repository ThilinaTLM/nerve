<script lang="ts">
import type { GitStashEntry } from "@nervekit/contracts/git";
import Archive from "@lucide/svelte/icons/archive";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import ScrollRegion from "@nervekit/ui-kit/components/composites/scroll-region";
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
const count = $derived(stashes.length);

function confirmDrop(stash: GitStashEntry): void {
  dropCandidate = undefined;
  onDrop(stash);
}

function cancelDropOnEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !dropCandidate) return;
  event.preventDefault();
  event.stopPropagation();
  dropCandidate = undefined;
}
</script>

<svelte:window onkeydowncapture={cancelDropOnEscape} />

<Dialog
  bind:open
  flush
  title="Stashes"
  description={`${repositoryName} · ${count} ${count === 1 ? "stash" : "stashes"}`}
  size="md"
  onOpenChange={(next) => {
    if (!next) dropCandidate = undefined;
  }}
>
  {#if stashes.length === 0}
    <Empty.Root class="py-10">
      <Empty.Header>
        <Empty.Media variant="icon"><Archive /></Empty.Media>
        <Empty.Title>No stashes</Empty.Title>
        <Empty.Description
          >Stash changes from the Git panel to set them aside without
          committing.</Empty.Description
        >
      </Empty.Header>
    </Empty.Root>
  {:else}
    <div class="flex max-h-96 min-h-0 flex-col p-1.5">
      <ScrollRegion
        ariaLabel="Stashes"
        contentClass="flex min-w-0 shrink-0 flex-col gap-0.5"
      >
        {#each stashes.slice(0, 100) as stash (stash.hash)}
          <GitStashRow
            {stash}
            {busy}
            {mutation}
            confirmingDrop={dropCandidate?.hash === stash.hash}
            {onApply}
            onRequestDrop={(candidate) => (dropCandidate = candidate)}
            onCancelDrop={() => (dropCandidate = undefined)}
            onConfirmDrop={confirmDrop}
          />
        {/each}
      </ScrollRegion>
    </div>
    {#if stashes.length > 100}
      <p class="px-3 pb-2 text-ui text-muted-foreground">
        Showing the first 100 of {stashes.length} stashes.
      </p>
    {/if}
  {/if}
</Dialog>
