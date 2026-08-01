<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import type { ModelInfo, ThinkingLevel } from "@nervekit/contracts";
import Popover from "@nervekit/ui-kit/components/ui/popover-panel";
import SearchInput from "@nervekit/ui-kit/components/ui/search-input";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { VirtualScroller } from "@nervekit/ui-kit/components/ui/virtual-list";
import { contextualModelLabel, modelKey } from "$lib/presentation/utils/model";
import {
  buildModelCatalog,
  filterModelCatalog,
  modelProviderFacets,
} from "$lib/presentation/utils/model-catalog";

type Props = {
  models?: ModelInfo[];
  selectedModelKey?: string;
  thinkingLevel?: ThinkingLevel;
  disabled?: boolean;
  shortcutLabel?: string;
  runtimeChangeHint?: string;
  emptyMessage?: string;
  onModelChange?: (value: string) => void;
  onThinkingLevelChange?: (value: ThinkingLevel) => void;
};

let {
  models = [],
  selectedModelKey = "",
  thinkingLevel = "off",
  disabled = false,
  shortcutLabel,
  runtimeChangeHint,
  emptyMessage = "No models available. Configure a provider or adjust Scoped Models in Settings.",
  onModelChange,
  onThinkingLevelChange,
}: Props = $props();

const SEARCH_THRESHOLD = 10;

let open = $state(false);
let query = $state("");
let providerFilter = $state("all");

const catalog = $derived(buildModelCatalog(models));
const providerChips = $derived(modelProviderFacets(catalog));
const filteredModels = $derived(
  filterModelCatalog(
    catalog,
    models.length > SEARCH_THRESHOLD ? query : "",
    models.length > SEARCH_THRESHOLD ? providerFilter : "all",
  ),
);
const selectedModel = $derived(
  models.find((model) => modelKey(model) === selectedModelKey),
);

const thinkingLevelDetails: Record<ThinkingLevel, string> = {
  off: "No reasoning",
  minimal: "Very brief reasoning",
  low: "Light reasoning",
  medium: "Moderate reasoning",
  high: "Deep reasoning",
  xhigh: "Extra-high reasoning",
  max: "Maximum reasoning",
};

function thinkingLevelLabel(level: ThinkingLevel): string {
  return level === "off" ? "Off" : level[0].toUpperCase() + level.slice(1);
}

function thinkingLevelShortLabel(level: ThinkingLevel): string {
  switch (level) {
    case "minimal":
      return "Mi";
    case "low":
      return "L";
    case "medium":
      return "M";
    case "high":
      return "H";
    case "xhigh":
      return "XH";
    case "max":
      return "Max";
    case "off":
    default:
      return "Off";
  }
}

const thinkingLevels = $derived<ThinkingLevel[]>(
  selectedModel?.supportedThinkingLevels?.length
    ? selectedModel.supportedThinkingLevels
    : ["off"],
);

const hasThinking = $derived(thinkingLevels.length > 1);

const triggerLabel = $derived(
  selectedModel ? contextualModelLabel(selectedModel, models) : "Select model",
);
const triggerSuffix = $derived(
  hasThinking && thinkingLevel !== "off"
    ? thinkingLevelLabel(thinkingLevel)
    : undefined,
);
const triggerShortSuffix = $derived(
  hasThinking && thinkingLevel !== "off"
    ? thinkingLevelShortLabel(thinkingLevel)
    : undefined,
);
const triggerTitle = $derived(
  `${triggerSuffix ? `${triggerLabel} (${triggerSuffix})` : triggerLabel}${runtimeChangeHint ? ` · ${runtimeChangeHint}` : ""}${shortcutLabel ? ` · Cycle thinking ${shortcutLabel}` : ""}`,
);

function handleOpenChange(next: boolean) {
  open = disabled ? false : next;
  if (open) {
    query = "";
    providerFilter = "all";
  }
}

function selectModel(model: ModelInfo) {
  if (disabled) return;
  const key = modelKey(model);
  if (key !== selectedModelKey) onModelChange?.(key);
}

function selectThinking(level: ThinkingLevel) {
  if (disabled) return;
  if (level !== thinkingLevel) onThinkingLevelChange?.(level);
}

$effect(() => {
  if (disabled) open = false;
});
</script>

<Popover
  {open}
  onOpenChange={handleOpenChange}
  class="model-picker-content"
  triggerClass="composer-tab model-tab"
  ariaLabel="Model and thinking level"
  {triggerTitle}
  side="top"
  align="end"
  sideOffset={9}
>
  {#snippet trigger()}
    <span class="model-tab-inner" class:disabled aria-disabled={disabled}>
      <span class="model-tab-label">{triggerLabel}</span>
      {#if triggerSuffix}<span class="model-tab-suffix">({triggerSuffix})</span
        >{/if}
      {#if triggerShortSuffix}<span class="model-tab-short-suffix"
          >({triggerShortSuffix})</span
        >{/if}
    </span>
  {/snippet}

  <div class="model-picker">
    <div class="model-picker-section">
      <p class="model-picker-heading">Model</p>
      {#if models.length === 0}
        <p class="model-picker-empty">{emptyMessage}</p>
      {:else}
        <div class="grid gap-2">
          {#if models.length > SEARCH_THRESHOLD}
            <SearchInput
              bind:value={query}
              placeholder="Search models"
              ariaLabel="Search models"
            />
            {#if providerChips.length > 2}
              <ToggleGroup.Root
                type="single"
                size="xs"
                spacing={1}
                variant="outline"
                value={providerFilter}
                aria-label="Filter by provider"
                class="flex-nowrap overflow-x-auto"
                onValueChange={(value) => {
                  if (value) providerFilter = value;
                }}
              >
                {#each providerChips as chip (chip.id)}
                  <ToggleGroup.Item
                    value={chip.id}
                    class="flex-none gap-1.5 text-xs"
                  >
                    {chip.label}
                    <span class="text-muted-foreground">{chip.count}</span>
                  </ToggleGroup.Item>
                {/each}
              </ToggleGroup.Root>
            {/if}
          {/if}
          {#if filteredModels.length === 0}
            <p class="model-picker-empty">No models match.</p>
          {:else}
            <VirtualScroller
              items={filteredModels}
              getKey={(entry) => entry.key}
              estimateSize={() => 34}
              viewportClass="max-h-[min(44vh,18rem)]"
              viewportAriaLabel="Available models"
            >
              {#snippet row({ item: entry })}
                {@const active = entry.key === selectedModelKey}
                <button
                  type="button"
                  class="model-row"
                  class:active
                  aria-pressed={active}
                  {disabled}
                  onclick={() => selectModel(entry.model)}
                >
                  <span class="model-row-text">
                    <span class="model-row-label">{entry.contextualLabel}</span>
                  </span>
                  {#if active}<Check size={14} strokeWidth={2.4} />{/if}
                </button>
              {/snippet}
            </VirtualScroller>
          {/if}
        </div>
      {/if}
    </div>

    {#if hasThinking}
      <div class="model-picker-section thinking-section">
        <p class="model-picker-heading">Thinking level</p>
        <div class="thinking-grid" role="group" aria-label="Thinking level">
          {#each thinkingLevels as level (level)}
            {@const active = level === thinkingLevel}
            <button
              type="button"
              class="thinking-chip rounded-full"
              class:active
              aria-pressed={active}
              title={thinkingLevelDetails[level]}
              {disabled}
              onclick={() => selectThinking(level)}
            >
              {thinkingLevelLabel(level)}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</Popover>

<style>
.model-tab-inner {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  max-width: clamp(7rem, 22vw, 16rem);
  color: inherit;
}

.model-tab-inner.disabled {
  opacity: 0.55;
}

.model-tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-tab-suffix,
.model-tab-short-suffix {
  flex: none;
  color: var(--muted-foreground);
}

.model-tab-short-suffix {
  display: none;
}

@media (max-width: 639px) {
  .model-tab-inner {
    max-width: clamp(5.75rem, 34vw, 9rem);
    gap: 0.22rem;
  }

  .model-tab-suffix {
    display: none;
  }

  .model-tab-short-suffix {
    display: inline;
  }
}

.model-picker {
  display: grid;
  gap: 0.7rem;
  padding: 0.7rem;
}

.model-picker-section {
  display: grid;
  gap: 0.4rem;
}

.thinking-section {
  border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
  padding-top: 0.7rem;
}

.model-picker-heading {
  margin: 0;
  color: var(--muted-foreground);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.model-picker-empty {
  margin: 0;
  color: var(--muted-foreground);
  font-size: var(--text-xs);
}

.model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  width: 100%;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--foreground);
  padding: 0.4rem 0.5rem;
  text-align: left;
  cursor: pointer;
}

.model-row:hover {
  background: var(--accent);
}

.model-row.active {
  border-color: color-mix(in oklab, var(--primary) 35%, transparent);
  background: color-mix(in oklab, var(--primary) 12%, transparent);
  color: var(--primary);
}

.model-row-text {
  display: grid;
  min-width: 0;
  gap: 0.05rem;
}

.model-row-label {
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thinking-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.thinking-chip {
  border: 1px solid var(--border);
  background: var(--input);
  color: var(--muted-foreground);
  padding: 0.2rem 0.6rem;
  font-size: var(--text-xs);
  font-weight: 500;
  cursor: pointer;
}

.thinking-chip:hover {
  border-color: color-mix(in oklab, var(--primary) 35%, transparent);
  color: var(--foreground);
}

.thinking-chip.active {
  border-color: var(--primary);
  background: color-mix(in oklab, var(--primary) 14%, transparent);
  color: var(--primary);
}
</style>
