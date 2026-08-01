<script lang="ts">
import type { ModelInfo, ModelSelection, ThinkingLevel } from "$lib/api";
import ArrowUpFromLine from "@lucide/svelte/icons/arrow-up-from-line";
import Braces from "@lucide/svelte/icons/braces";
import Brain from "@lucide/svelte/icons/brain";
import Image from "@lucide/svelte/icons/image";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { PopoverRow } from "@nervekit/ui-kit/components/ui/popover-panel";
import SearchInput from "@nervekit/ui-kit/components/ui/search-input";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { VirtualScroller } from "@nervekit/ui-kit/components/ui/virtual-list";
import {
  formatTokenCapacity,
  modelKey,
  supportsImageInput,
} from "$lib/presentation/utils/model";
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

let selectedKey = $state<string | undefined>();
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
    selectedKey = selectedModel ? modelKey(selectedModel) : undefined;
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

function capabilitySummary(model: ModelInfo): string {
  const parts = [
    model.contextWindow > 0
      ? `Context ${model.contextWindow.toLocaleString()} tokens`
      : "Context window unknown",
  ];
  if (model.maxOutputTokens > 0)
    parts.push(`Max output ${model.maxOutputTokens.toLocaleString()} tokens`);
  parts.push(model.reasoning ? "Reasoning model" : "No reasoning");
  parts.push(
    supportsImageInput(model) ? "Accepts image input" : "Text input only",
  );
  return parts.join(" · ");
}

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

<Dialog bind:open {title} {description} size="md" flush>
  <div class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
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
          <div class="grid min-h-0">
            <VirtualScroller
              items={filteredModels}
              getKey={(entry) => entry.key}
              estimateSize={() => 46}
              gap={6}
              viewportClass="h-full max-h-[min(52vh,22rem)]"
              viewportAriaLabel="Available models"
            >
              {#snippet row({ item: entry })}
                <PopoverRow
                  label={entry.displayName}
                  selected={selectedKey === entry.key}
                  class="px-2 py-1.5 aria-pressed:border-primary/60"
                  onclick={() => (selectedKey = entry.key)}
                >
                  {#snippet detail()}
                    <span class="truncate text-xs text-muted-foreground">
                      {entry.providerLabel} ·
                      <span class="font-mono">{entry.model.modelId}</span>
                    </span>
                  {/snippet}
                  {#snippet trailing()}
                    <Tooltip.Root>
                      <Tooltip.Trigger>
                        {#snippet child({ props })}
                          <span
                            {...props}
                            class="flex flex-none items-center gap-1 text-[0.6875rem] text-muted-foreground tabular-nums"
                            aria-label={capabilitySummary(entry.model)}
                          >
                            <span class="inline-flex items-center gap-0.5">
                              <Braces class="size-3" aria-hidden="true" />
                              {formatTokenCapacity(entry.model.contextWindow)}
                            </span>
                            {#if entry.model.maxOutputTokens > 0}
                              <span class="inline-flex items-center gap-0.5">
                                <ArrowUpFromLine
                                  class="size-3"
                                  aria-hidden="true"
                                />
                                {formatTokenCapacity(
                                  entry.model.maxOutputTokens,
                                )}
                              </span>
                            {/if}
                            {#if entry.model.reasoning}
                              <Brain class="size-3" aria-hidden="true" />
                            {/if}
                            {#if supportsImageInput(entry.model)}
                              <Image class="size-3" aria-hidden="true" />
                            {/if}
                          </span>
                        {/snippet}
                      </Tooltip.Trigger>
                      <Tooltip.Content side="left">
                        {capabilitySummary(entry.model)}
                      </Tooltip.Content>
                    </Tooltip.Root>
                  {/snippet}
                </PopoverRow>
              {/snippet}
            </VirtualScroller>
          </div>
        {/if}
      </div>
    </Tooltip.Provider>
  </div>

  {#snippet footer()}
    <div class="grid w-full gap-2">
      <div class="grid gap-1">
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
      <div class="flex flex-wrap items-center justify-end gap-2">
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
      </div>
    </div>
  {/snippet}
</Dialog>
