<script lang="ts">
import type { ModelInfo, ModelSelection, ThinkingLevel } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import SearchInput from "@nervekit/ui-kit/components/ui/search-input";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { SelectRow } from "@nervekit/ui-kit/components/ui/select-row";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { VirtualScroller } from "@nervekit/ui-kit/components/ui/virtual-list";
import { modelKey } from "$lib/presentation/utils/model";
import ModelCatalogRow from "./ModelCatalogRow.svelte";
import {
  buildModelCatalog,
  filterModelCatalog,
  modelProviderFacets,
  type ModelCatalogEntry,
} from "$lib/presentation/utils/model-catalog";
type FallbackOption = {
  label: string;
  detail: string;
  /** Footer button copy, e.g. "Use default model". */
  actionLabel: string;
};
type SaveSelection = {
  model?: ModelSelection;
  thinkingLevel: ThinkingLevel;
};

type Props = {
  open?: boolean;
  title: string;
  description?: string;
  models?: ModelInfo[];
  selectedModel?: ModelSelection;
  selectedThinkingLevel: ThinkingLevel;
  fallbackOption?: FallbackOption;
  fallbackThinkingLevels?: ThinkingLevel[];
  onSave?: (selection: SaveSelection) => void;
  showThinkingLevel?: boolean;
  emptyMessage?: string;
};

let {
  open = $bindable(false),
  title,
  description,
  models = [],
  selectedModel,
  selectedThinkingLevel,
  fallbackOption,
  fallbackThinkingLevels = ["off"],
  onSave,
  showThinkingLevel = true,
  emptyMessage = "Authenticate a provider before choosing a model.",
}: Props = $props();

let selectedKey = $state("");
let thinkingLevel = $state<ThinkingLevel>("off");
let query = $state("");
let providerFilter = $state("all");
let lastOpen = false;

const selectedModelInfo = $derived(
  selectedKey
    ? models.find((model) => modelKey(model) === selectedKey)
    : undefined,
);
const thinkingLevels = $derived<ThinkingLevel[]>(
  selectedModelInfo?.supportedThinkingLevels?.length
    ? selectedModelInfo.supportedThinkingLevels
    : fallbackThinkingLevels,
);

$effect(() => {
  if (open && !lastOpen) {
    selectedKey = selectedModel ? modelKey(selectedModel) : "";
    thinkingLevel = selectedThinkingLevel;
    query = "";
    providerFilter = "all";
  }
  lastOpen = open;
});

$effect(() => {
  const levels = thinkingLevels;
  if (levels.length > 0 && !levels.includes(thinkingLevel)) {
    thinkingLevel = levels[0];
  }
});

const catalog = $derived(buildModelCatalog(models));
const providerChips = $derived(modelProviderFacets(catalog));
const filteredModels = $derived(
  filterModelCatalog(catalog, query, providerFilter),
);

type ListItem = { key: string; entry: ModelCatalogEntry | null };
/** The default/fallback option is a scrolled item of the list, not pinned. */
const listItems = $derived<ListItem[]>(
  fallbackOption
    ? [
        { key: "$default", entry: null },
        ...filteredModels.map((entry) => ({ key: entry.key, entry })),
      ]
    : filteredModels.map((entry) => ({ key: entry.key, entry })),
);
const canSave = $derived(
  Boolean(selectedModelInfo) ||
    (fallbackOption !== undefined && selectedKey === ""),
);

function save(): void {
  if (selectedKey === "") {
    if (fallbackOption) useFallback();
    return;
  }
  if (!selectedModelInfo) return;
  onSave?.({
    model: {
      provider: selectedModelInfo.provider,
      modelId: selectedModelInfo.modelId,
    },
    thinkingLevel,
  });
  open = false;
}

/** Clears the explicit model so the caller falls back to its platform default. */
function useFallback(): void {
  const level = fallbackThinkingLevels.includes(thinkingLevel)
    ? thinkingLevel
    : (fallbackThinkingLevels[0] ?? "off");
  onSave?.({ model: undefined, thinkingLevel: level });
  open = false;
}
</script>

<Dialog
  bind:open
  {title}
  {description}
  size="md"
  flush
  closeOnInteractOutside={false}
>
  <div class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
    <div class="grid gap-1.5 border-b border-border/50 px-3 pt-2.5 pb-2">
      {#if models.length > 0}
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
      <div class="flex flex-col gap-1.5 overflow-hidden px-3 py-2">
        {#if models.length === 0}
          <p class="py-1 text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        {:else if listItems.length === 0}
          <p class="py-1 text-sm text-muted-foreground">
            No models match the current filters.
          </p>
        {:else}
          <div class="h-[min(52vh,24rem)]">
            <VirtualScroller
              items={listItems}
              getKey={(item) => item.key}
              estimateSize={() => 44}
              gap={4}
              viewportClass="h-full"
              viewportAriaLabel="Available models"
            >
              {#snippet row({ item })}
                {#if item.entry}
                  {@const entry = item.entry}
                  <ModelCatalogRow
                    {entry}
                    selected={entry.key === selectedKey}
                    onclick={() => (selectedKey = entry.key)}
                  />
                {:else}
                  <SelectRow
                    selected={selectedKey === ""}
                    label={fallbackOption!.label}
                    detail={fallbackOption!.detail}
                    onclick={() => (selectedKey = "")}
                  />
                {/if}
              {/snippet}
            </VirtualScroller>
          </div>
        {/if}
      </div>
    </Tooltip.Provider>
  </div>

  {#snippet footer()}
    <div class="flex w-full flex-wrap items-center gap-2">
      {#if showThinkingLevel}
        <ToggleGroup.Root
          type="single"
          size="xs"
          spacing={1}
          variant="chip"
          value={thinkingLevel}
          aria-label="Thinking level"
          class="mr-auto min-w-0 flex-wrap justify-start"
          onValueChange={(value) => {
            if (value) thinkingLevel = value as ThinkingLevel;
          }}
        >
          {#each thinkingLevels as level (level)}
            <ToggleGroup.Item
              value={level}
              class="flex-none text-xs capitalize data-[state=on]:text-primary"
              >{level}</ToggleGroup.Item
            >
          {/each}
        </ToggleGroup.Root>
      {/if}
      <div
        class="ml-auto flex flex-none flex-wrap items-center justify-end gap-2"
      >
        <Button size="sm" variant="ghost" onclick={() => (open = false)}
          >Cancel</Button
        >
        <Button size="sm" onclick={save} disabled={!canSave}>Save</Button>
      </div>
    </div>
  {/snippet}
</Dialog>
