<!--
  Multi-select over the model catalog, for choosing which models pickers offer
  (the model scope; empty means every authenticated model). Same language as
  the pickers: one search across models, providers and capabilities, results
  grouped under provider headers with a checked count; arrows move through
  rows from the search field and Enter toggles. Not the single-model picker, which also chooses a reasoning
  level. Consumers can decorate rows via `rowBadge` and `rowTrailing`.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { ModelInfo, ModelSelection } from "@nervekit/contracts/models";
import { createListNavigation } from "@nervekit/ui-kit/components/composites/popover-panel";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import {
  VirtualScroller,
  type VirtualScrollerController,
} from "@nervekit/ui-kit/components/composites/virtual-list";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { buildModelCatalog } from "$lib/presentation/utils/model-catalog";
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

const uid = $props.id();
const listId = `${uid}-models`;
let viewChoice = $state<ScopedCatalogView>();
let query = $state("");
let controller = $state<VirtualScrollerController>();

const view = $derived<ScopedCatalogView>(
  viewChoice ?? (scopedModels.length > 0 ? "scoped" : "all"),
);
const catalog = $derived(buildModelCatalog(models));
const items = $derived(
  scopedCatalogRows({ entries: catalog, scoped: scopedModels, view, query }),
);
const rows = $derived(
  items.filter((item): item is ScopedCatalogRow => item.kind === "model"),
);
const scopeEmpty = $derived(scopedModels.length === 0);

const rowId = (row: ScopedCatalogRow) =>
  `${uid}-row-${encodeURIComponent(row.key)}`;
const navigation = createListNavigation({
  items: () => rows,
  getId: rowId,
  onChoose: (row) => toggle(row.selection, !row.checked),
});

$effect(() => {
  const active = rows[navigation.index];
  const index = active ? items.indexOf(active) : -1;
  if (index >= 0) controller?.scrollToIndex(index, { align: "auto" });
});

function toggle(selection: ModelSelection, checked: boolean): void {
  onScopedModelsChange(toggleScopedModel(scopedModels, selection, checked));
}

function handleSearchKeydown(event: KeyboardEvent): void {
  // Space types in the field; Enter toggles the highlighted row.
  if (event.key === "Enter") {
    event.preventDefault();
    navigation.chooseActive();
    return;
  }
  navigation.handleKeydown(event);
}
</script>

<div
  class="overflow-hidden rounded-md border border-border bg-card group-data-settings-surface/surface:-mx-3 group-data-settings-surface/surface:rounded-none group-data-settings-surface/surface:border-x-0 group-data-settings-surface/surface:border-t-0"
>
  <div class="flex items-center gap-1.5 border-b border-border-subtle p-2">
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
        navigation.reset();
      }}
    >
      <ToggleGroup.Item value="scoped" class="gap-1.5">
        Scoped <span data-slot="toggle-count">{scopedModels.length}</span>
      </ToggleGroup.Item>
      <ToggleGroup.Item value="all" class="gap-1.5">
        All <span data-slot="toggle-count">{catalog.length}</span>
      </ToggleGroup.Item>
    </ToggleGroup.Root>
    <SearchInput
      bind:value={query}
      class="min-w-0 flex-1"
      placeholder="Search models, providers, capabilities"
      ariaLabel="Search models"
      controls={listId}
      activeDescendant={navigation.activeDescendant}
      onValueChange={() => navigation.reset()}
      onkeydown={handleSearchKeydown}
    />
  </div>

  <div data-tour-id="setup-scoped-models-catalog">
    <Tooltip.Provider delayDuration={300} disableHoverableContent>
      {#if rows.length === 0}
        <div
          class="flex items-center gap-2 px-3 py-3 text-ui text-muted-foreground"
        >
          {#if view === "scoped" && scopeEmpty && !query.trim()}
            <span class="flex-1"
              >No scope set. Every authenticated model is offered in pickers.</span
            >
            <Button
              size="sm"
              variant="outline"
              onclick={() => (viewChoice = "all")}>Browse all models</Button
            >
          {:else}
            No models match “{query.trim()}”.
          {/if}
        </div>
      {:else}
        <div
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label="Model catalog"
          class="px-1 py-1"
        >
          <VirtualScroller
            {items}
            bind:controller
            getKey={(item) => item.key}
            estimateSize={() => 32}
            gap={0}
            viewportClass="max-h-[min(55vh,26rem)]"
          >
            {#snippet row({ item })}
              {#if item.kind === "header"}
                <div
                  role="presentation"
                  class="flex items-center gap-1.5 px-2 pt-2.5 pb-1 text-ui text-muted-foreground"
                >
                  {#if !item.provider}
                    <TriangleAlert
                      class="size-3.5 flex-none text-warning"
                      aria-hidden="true"
                    />
                  {/if}
                  <span class="truncate">{item.label}</span>
                  <span class="tabular-nums"
                    >{item.checked}/{item.selections.length}</span
                  >
                </div>
              {:else}
                {@const label =
                  item.entry?.displayName ?? item.selection.modelId}
                <ModelCatalogRow
                  mode="checkbox"
                  id={rowId(item)}
                  {label}
                  title={`${item.selection.provider}/${item.selection.modelId}`}
                  model={item.entry?.model}
                  selected={item.checked}
                  active={navigation.activeDescendant === rowId(item)}
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
              {/if}
            {/snippet}
          </VirtualScroller>
        </div>
      {/if}
    </Tooltip.Provider>
  </div>

  <p
    class="flex items-center gap-1.5 border-t border-border-subtle px-3 py-1.5 text-ui text-muted-foreground"
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
