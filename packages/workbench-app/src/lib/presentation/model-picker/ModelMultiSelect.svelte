<!--
  Multi-select over the model catalog, for choosing which models pickers offer
  (the model scope; empty means every authenticated model). Search, provider
  and capability filters, checkbox rows. Not the single-model picker, which
  also chooses a reasoning level. Consumers can decorate rows via `rowBadge`
  and `rowTrailing`.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import type { ModelInfo, ModelSelection } from "@nervekit/contracts/models";
import { VirtualScroller } from "@nervekit/ui-kit/components/composites/virtual-list";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import {
  buildModelCatalog,
  type ModelCapability,
} from "$lib/presentation/utils/model-catalog";
import ModelCatalogFilters from "./ModelCatalogFilters.svelte";
import ModelCatalogRow from "./ModelCatalogRow.svelte";
import {
  scopedCatalogRows,
  toggleScopedModel,
  type ScopedCatalogRow,
  type ScopedCatalogView,
} from "./model-picker";

type Props = {
  /** Authenticated, non-faux models. */
  models: ModelInfo[];
  scopedModels: ModelSelection[];
  onScopedModelsChange: (next: ModelSelection[]) => void;
  /** Extra badge after a row's label. */
  rowBadge?: Snippet<[ScopedCatalogRow]>;
  /** Replaces the stale "Unavailable" badge slot for live rows (e.g. actions). */
  rowTrailing?: Snippet<[ScopedCatalogRow]>;
  /** Footer hint appended after the counts. */
  footnote?: Snippet;
};

let {
  models,
  scopedModels,
  onScopedModelsChange,
  rowBadge,
  rowTrailing,
  footnote,
}: Props = $props();

let viewChoice = $state<ScopedCatalogView>();
let query = $state("");
let provider = $state("all");
let capabilities = $state<ModelCapability[]>([]);

const view = $derived<ScopedCatalogView>(
  viewChoice ?? (scopedModels.length > 0 ? "scoped" : "all"),
);
const catalog = $derived(buildModelCatalog(models));
const rows = $derived(
  scopedCatalogRows({
    entries: catalog,
    scoped: scopedModels,
    view,
    query,
    provider,
    capabilities: new Set(capabilities),
  }),
);
const scopeEmpty = $derived(scopedModels.length === 0);

function toggle(selection: ModelSelection, checked: boolean): void {
  onScopedModelsChange(toggleScopedModel(scopedModels, selection, checked));
}
</script>

<div
  class="overflow-hidden rounded-md border border-border bg-card group-data-settings-surface/surface:-mx-3 group-data-settings-surface/surface:rounded-none group-data-settings-surface/surface:border-x-0 group-data-settings-surface/surface:border-t-0"
>
  <ModelCatalogFilters
    class="border-b border-border/60 p-2"
    entries={catalog}
    bind:query
    bind:provider
    bind:capabilities
  >
    {#snippet leading()}
      <ToggleGroup.Root
        type="single"
        spacing={1}
        variant="chip"
        value={view}
        aria-label="Show models"
        class="flex-none"
        data-tour-id="setup-scoped-models-view"
        onValueChange={(next) => {
          if (next) viewChoice = next as ScopedCatalogView;
        }}
      >
        <ToggleGroup.Item value="scoped" class="gap-1.5">
          Scoped <span data-slot="toggle-count">{scopedModels.length}</span>
        </ToggleGroup.Item>
        <ToggleGroup.Item value="all" class="gap-1.5">
          All <span data-slot="toggle-count">{catalog.length}</span>
        </ToggleGroup.Item>
      </ToggleGroup.Root>
    {/snippet}
  </ModelCatalogFilters>

  <div data-tour-id="setup-scoped-models-catalog">
    <Tooltip.Provider delayDuration={300} disableHoverableContent>
      {#if rows.length === 0}
        <div
          class="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground"
        >
          {#if view === "scoped" && scopeEmpty}
            <span class="flex-1"
              >No scope set. Every authenticated model is offered in pickers.</span
            >
            <Button
              size="sm"
              variant="outline"
              onclick={() => (viewChoice = "all")}>Browse all models</Button
            >
          {:else}
            No models match the current filters.
          {/if}
        </div>
      {:else}
        <VirtualScroller
          items={rows}
          getKey={(row) => row.key}
          estimateSize={() => 32}
          gap={0}
          viewportClass="max-h-[min(55vh,26rem)]"
          viewportAriaLabel="Model catalog"
        >
          {#snippet row({ item })}
            {@const label = item.entry?.displayName ?? item.selection.modelId}
            {@const model = item.entry?.model}
            <ModelCatalogRow
              mode="checkbox"
              {label}
              detail={item.entry?.providerLabel ?? item.selection.provider}
              title={`${item.selection.provider}/${item.selection.modelId}`}
              {model}
              selected={item.checked}
              onclick={() => toggle(item.selection, !item.checked)}
            >
              {#snippet badge()}
                {#if rowBadge}{@render rowBadge(item)}{/if}
              {/snippet}
              {#snippet trailing()}
                {#if item.stale}
                  <Badge variant="warning">Unavailable</Badge>
                {:else if rowTrailing}
                  {@render rowTrailing(item)}
                {/if}
              {/snippet}
            </ModelCatalogRow>
          {/snippet}
        </VirtualScroller>
      {/if}
    </Tooltip.Provider>
  </div>

  <p
    class="flex items-center gap-1.5 border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground"
    data-tour-id="setup-scoped-models-default"
  >
    <span class="tabular-nums">{rows.length} shown</span>
    <span aria-hidden="true">·</span>
    {#if scopeEmpty}
      Nothing checked — pickers offer every authenticated model.
    {:else}
      <span class="tabular-nums">{scopedModels.length} scoped</span>
    {/if}
    {#if footnote}
      <span aria-hidden="true">·</span>
      {@render footnote()}
    {/if}
  </p>
</div>
