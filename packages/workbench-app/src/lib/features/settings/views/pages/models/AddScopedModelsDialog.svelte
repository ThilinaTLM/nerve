<script lang="ts">
import { SvelteSet } from "svelte/reactivity";
import type { AuthProviderMetadata, ModelInfo, ModelSelection } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { VirtualScroller } from "@nervekit/ui-kit/components/composites/virtual-list";
import ModelCatalogRow from "../../shared/ModelCatalogRow.svelte";
import {
  authenticatedRealModelOptions,
  modelKey,
} from "$lib/presentation/utils/model";
import {
  buildModelCatalog,
  filterModelCatalog,
  modelProviderFacets,
  type ModelCatalogEntry,
} from "$lib/presentation/utils/model-catalog";

type Props = {
  open?: boolean;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  scopedModels?: ModelSelection[];
  onSave?: (next: ModelSelection[]) => void;
};

let {
  open = $bindable(false),
  models = [],
  authProviders = [],
  scopedModels = [],
  onSave,
}: Props = $props();

let selectedKeys = $state<Set<string>>(new Set());
let query = $state("");
let providerFilter = $state("all");
let lastOpen = false;

const availableModels = $derived(
  authenticatedRealModelOptions(models, authProviders),
);

// Seed the working selection from the saved scope each time the dialog opens.
$effect(() => {
  if (open && !lastOpen) {
    selectedKeys = new Set(scopedModels.map(modelKey));
    query = "";
    providerFilter = "all";
  }
  lastOpen = open;
});

const catalog = $derived(buildModelCatalog(availableModels));
const providerChips = $derived(modelProviderFacets(catalog));
const filteredModels = $derived(
  filterModelCatalog(catalog, query, providerFilter),
);

const selectedCount = $derived(selectedKeys.size);

function toggleModel(entry: ModelCatalogEntry, checked: boolean): void {
  const next = new SvelteSet(selectedKeys);
  const key = entry.key;
  if (checked) next.add(key);
  else next.delete(key);
  selectedKeys = next;
}

function save(): void {
  const next = availableModels
    .filter((model) => selectedKeys.has(modelKey(model)))
    .map((model) => ({ provider: model.provider, modelId: model.modelId }));
  onSave?.(next);
  open = false;
}
</script>

<Dialog
  bind:open
  title="Scope composer models"
  description="Pick the authenticated models to show in the composer. Leave everything unchecked to keep all models available."
  size="md"
  flush
  closeOnInteractOutside={false}
>
  <div
    class="grid max-h-[min(80vh,40rem)] grid-rows-[auto_minmax(0,1fr)]"
    data-tour-id="setup-scoped-models-catalog"
  >
    <div class="grid gap-1.5 border-b border-border/50 px-3 pt-2.5 pb-2">
      {#if availableModels.length > 0}
        <ToggleGroup.Root
          type="single"
          size="xs"
          spacing={1}
          variant="chip"
          value={providerFilter}
          aria-label="Filter by provider"
          class="flex-wrap"
          onValueChange={(value) => {
            if (value) providerFilter = value;
          }}
        >
          {#each providerChips as chip (chip.id)}
            <ToggleGroup.Item value={chip.id} class="gap-1.5 text-xs">
              {chip.label}
              <span class="text-muted-foreground">{chip.count}</span>
            </ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>
      {/if}
      <SearchInput
        bind:value={query}
        placeholder="Search models"
        ariaLabel="Search models"
      />
    </div>

    <Tooltip.Provider delayDuration={200} disableHoverableContent>
      <div class="h-[min(60vh,32rem)] p-1.5">
        {#if availableModels.length === 0}
          <p class="px-1 py-2 text-sm text-muted-foreground">
            Authenticate a provider before choosing scoped models.
          </p>
        {:else if filteredModels.length === 0}
          <p class="px-1 py-2 text-sm text-muted-foreground">
            No models match the current filters.
          </p>
        {:else}
          <VirtualScroller
            items={filteredModels}
            getKey={(entry) => entry.key}
            estimateSize={() => 44}
            gap={4}
            viewportClass="h-full"
            viewportAriaLabel="Authenticated models"
          >
            {#snippet row({ item: entry })}
              {@const checked = selectedKeys.has(entry.key)}
              <ModelCatalogRow
                {entry}
                selectionMode="multiple"
                selected={checked}
                onclick={() => toggleModel(entry, !checked)}
              />
            {/snippet}
          </VirtualScroller>
        {/if}
      </div>
    </Tooltip.Provider>
  </div>

  {#snippet footer()}
    <span class="mr-auto text-xs text-muted-foreground">
      {selectedCount === 0
        ? "All models available"
        : `${selectedCount} selected`}
    </span>
    <Button size="sm" variant="ghost" onclick={() => (open = false)}
      >Cancel</Button
    >
    <Button
      size="sm"
      data-tour-id="setup-scoped-models-save"
      onclick={save}
      disabled={availableModels.length === 0}>Save</Button
    >
  {/snippet}
</Dialog>
