<script lang="ts">
import type { ModelInfo, ModelSelection, ThinkingLevel } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import * as RadioGroup from "@nervekit/ui-kit/components/ui/radio-group";
import SearchInput from "@nervekit/ui-kit/components/ui/search-input";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { VirtualScroller } from "@nervekit/ui-kit/components/ui/virtual-list";
import { modelKey } from "$lib/presentation/utils/model";
import ModelCatalogRow from "./ModelCatalogRow.svelte";
import {
  buildModelCatalog,
  filterModelCatalog,
  modelProviderFacets,
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
  confirmLabel?: string;
  onSave?: (selection: SaveSelection) => void;
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
  confirmLabel = "Save selection",
  onSave,
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

function save(): void {
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
      <SearchInput
        bind:value={query}
        placeholder="Search models"
        ariaLabel="Search models"
      />
      {#if models.length > 0}
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

    <Tooltip.Provider delayDuration={200} disableHoverableContent>
      <div class="grid min-h-0 grid-rows-[minmax(0,1fr)] px-3 py-2">
        {#if models.length === 0}
          <p class="py-1 text-sm text-muted-foreground">
            Authenticate a provider before choosing a model.
          </p>
        {:else if filteredModels.length === 0}
          <p class="py-1 text-sm text-muted-foreground">
            No models match the current filters.
          </p>
        {:else}
          <RadioGroup.Root bind:value={selectedKey} class="grid min-h-0 gap-0">
            <VirtualScroller
              items={filteredModels}
              getKey={(entry) => entry.key}
              estimateSize={() => 46}
              gap={6}
              viewportClass="h-full max-h-[min(52vh,22rem)]"
              viewportAriaLabel="Available models"
            >
              {#snippet row({ item: entry })}
                <Label
                  class="flex cursor-pointer items-center gap-2.5 rounded-md border border-border bg-transparent px-2 py-1.5 font-normal transition-colors hover:bg-accent has-data-checked:border-primary/60 has-data-checked:bg-accent"
                >
                  <ModelCatalogRow {entry}>
                    {#snippet leading()}
                      <RadioGroup.Item
                        value={entry.key}
                        size="sm"
                        aria-label={entry.displayName}
                      />
                    {/snippet}
                  </ModelCatalogRow>
                </Label>
              {/snippet}
            </VirtualScroller>
          </RadioGroup.Root>
        {/if}
      </div>
    </Tooltip.Provider>

    <div class="grid gap-1 border-t border-border/50 px-3 py-2">
      <span class="text-xs text-muted-foreground">Thinking level</span>
      <ToggleGroup.Root
        type="single"
        size="xs"
        spacing={1}
        variant="outline"
        value={thinkingLevel}
        aria-label="Thinking level"
        class="min-w-0 flex-wrap justify-start"
        onValueChange={(value) => {
          if (value) thinkingLevel = value as ThinkingLevel;
        }}
      >
        {#each thinkingLevels as level (level)}
          <ToggleGroup.Item
            value={level}
            class="flex-none rounded-full text-xs capitalize data-[state=on]:text-primary"
            >{level}</ToggleGroup.Item
          >
        {/each}
      </ToggleGroup.Root>
    </div>
  </div>

  {#snippet footer()}
    <Button size="sm" variant="ghost" onclick={() => (open = false)}
      >Cancel</Button
    >
    {#if fallbackOption}
      <Button
        size="sm"
        variant="outline"
        title={fallbackOption.detail}
        onclick={useFallback}>{fallbackOption.actionLabel}</Button
      >
    {/if}
    <Button size="sm" onclick={save} disabled={!selectedModelInfo}
      >{confirmLabel}</Button
    >
  {/snippet}
</Dialog>
