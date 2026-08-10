<script lang="ts">
import { SvelteSet } from "svelte/reactivity";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import LogRow from "./LogRow.svelte";
import LogsToolbar from "./LogsToolbar.svelte";
import type { LogsPaneActions, LogsPaneModel } from "./logs-pane-types";

type Props = {
  model: LogsPaneModel;
  actions: LogsPaneActions;
};

let { model, actions }: Props = $props();

let confirmPruneOpen = $state(false);
const expanded = new SvelteSet<string>();
const toolbarActions = $derived({
  ...actions,
  onPrune: () => {
    confirmPruneOpen = true;
  },
});

function toggleRow(id: string): void {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
}

async function prune(): Promise<void> {
  if (await actions.onPrune()) expanded.clear();
}
</script>

<section class="flex size-full min-h-0 flex-col bg-background">
  <LogsToolbar
    level={model.level}
    source={model.source}
    component={model.component}
    contains={model.contains}
    rowCount={model.rows.length}
    filtersActive={model.filtersActive}
    loading={model.loading}
    pruning={model.pruning}
    actions={toolbarActions}
  />

  {#if model.error}
    <div
      class="mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-sm text-destructive"
      role="alert"
    >
      {model.error}
    </div>
  {/if}
  {#if model.notice}
    <div
      class="mx-3 mt-2 rounded-md border border-success/40 bg-success/10 px-2.5 py-2 text-sm text-success"
      role="status"
    >
      {model.notice}
    </div>
  {/if}

  <ScrollArea class="min-h-0 flex-1">
    <div class="flex flex-col pb-2" role="log" aria-label="Application logs">
      {#if model.rows.length === 0 && !model.loading}
        <div
          class="mx-3 my-4 grid min-h-48 place-items-center rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground"
        >
          No application logs match these filters.
        </div>
      {/if}
      {#each model.rows as log (log.id)}
        <LogRow
          {log}
          open={expanded.has(log.id)}
          onToggle={() => toggleRow(log.id)}
        />
      {/each}
    </div>
  </ScrollArea>
</section>

<ConfirmDialog
  bind:open={confirmPruneOpen}
  title={model.filtersActive ? "Prune filtered logs?" : "Prune all logs?"}
  description={model.pruneDescription}
  confirmLabel={model.filtersActive ? "Prune filtered logs" : "Prune all logs"}
  destructive
  onConfirm={() => void prune()}
/>
