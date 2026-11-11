<script lang="ts">
// Test-only: drives ConfirmDialog the way list panels do (unbound or bound).
import ConfirmDialog from "./confirm-dialog.svelte";

let {
  bound = false,
  onDone,
}: { bound?: boolean; onDone: (id: string) => void } = $props();
const items = ["a", "b", "c"];
let pending = $state<string | undefined>();
let boundOpen = $state(false);

function remove() {
  const id = pending;
  pending = undefined;
  if (id) onDone(id);
}
</script>

{#if bound}
  <button onclick={() => (boundOpen = true)}>open-bound</button>
  <span data-testid="bound-state">{boundOpen}</span>
  <ConfirmDialog
    bind:open={boundOpen}
    title="Delete?"
    confirmLabel="Delete"
    onConfirm={() => onDone("bound")}
  />
{:else}
  {#each items as item (item)}
    <button onclick={() => (pending = item)}>delete-{item}</button>
  {/each}
  <ConfirmDialog
    open={Boolean(pending)}
    destructive
    title="Delete?"
    confirmLabel="Delete"
    onConfirm={remove}
    onCancel={() => (pending = undefined)}
    onOpenChange={(open) => {
      if (!open) pending = undefined;
    }}
  />
{/if}
