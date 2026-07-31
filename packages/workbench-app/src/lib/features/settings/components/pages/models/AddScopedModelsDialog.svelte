<script lang="ts">
import { SvelteSet } from "svelte/reactivity";
import type { AuthProviderMetadata, ModelInfo, ModelSelection } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import SearchInput from "@nervekit/ui-kit/components/ui/search-input";
import { Checkbox } from "@nervekit/ui-kit/components/ui/checkbox";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { VirtualScroller } from "@nervekit/ui-kit/components/ui/virtual-list";
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
  size="wide"
  flush
>
  <div class="grid max-h-[min(70vh,32rem)] grid-rows-[auto_minmax(0,1fr)]">
    <div class="grid gap-2 border-b border-border/50 px-3.5 pt-3 pb-2.5">
      <SearchInput
        bind:value={query}
        placeholder="Search models"
        ariaLabel="Search models"
      />
      {#if availableModels.length > 0}
        <ToggleGroup.Root
          type="single"
          size="xs"
          spacing={1}
          variant="outline"
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
    </div>

    <div class="min-h-0 p-1.5">
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
          estimateSize={() => 48}
          viewportClass="max-h-[min(52vh,24rem)]"
          viewportAriaLabel="Authenticated models"
        >
          {#snippet row({ item: entry })}
            {@const checked = selectedKeys.has(entry.key)}
            <Label
              class="flex cursor-pointer items-center gap-3 rounded-md border border-transparent px-2 py-1.5 font-normal hover:bg-accent/50 has-data-[state=checked]:border-primary/60 has-data-[state=checked]:bg-primary/8"
            >
              <Checkbox
                size="sm"
                {checked}
                onCheckedChange={(value) => toggleModel(entry, value === true)}
                aria-label={entry.displayName}
              />
              <span class="grid min-w-0 gap-0.5">
                <span class="truncate text-sm text-foreground"
                  >{entry.displayName}</span
                >
                <span class="truncate text-xs text-muted-foreground">
                  {entry.providerLabel} ·
                  <span class="font-mono">{entry.model.modelId}</span>
                </span>
              </span>
            </Label>
          {/snippet}
        </VirtualScroller>
      {/if}
    </div>
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
    <Button size="sm" onclick={save} disabled={availableModels.length === 0}
      >Save selection</Button
    >
  {/snippet}
</Dialog>
