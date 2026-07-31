<script lang="ts">
import type {
  AuthProviderMetadata,
  ModelInfo,
  ModelSelection,
  ThinkingLevel,
} from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import SearchInput from "@nervekit/ui-kit/components/ui/search-input";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { VirtualScroller } from "@nervekit/ui-kit/components/ui/virtual-list";
import { modelKey } from "$lib/presentation/utils/model";
import {
  buildModelCatalog,
  filterModelCatalog,
  modelProviderFacets,
} from "$lib/presentation/utils/model-catalog";
type FallbackOption = { label: string; detail: string };
type SaveSelection = {
  model?: ModelSelection;
  thinkingLevel: ThinkingLevel;
};

type Props = {
  open?: boolean;
  title: string;
  description?: string;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
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

const fallbackKey = "__fallback__";
const hasFallback = $derived(!!fallbackOption);
const selectedModelInfo = $derived(
  selectedKey && selectedKey !== fallbackKey
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
    selectedKey = selectedModel ? modelKey(selectedModel) : fallbackKey;
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

function formatTokens(tokens: number): string {
  if (tokens <= 0) return "Unknown context";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M context`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K context`;
  return `${tokens.toLocaleString()} context`;
}

function save(): void {
  const model = selectedModelInfo
    ? {
        provider: selectedModelInfo.provider,
        modelId: selectedModelInfo.modelId,
      }
    : undefined;
  onSave?.({ model, thinkingLevel });
  open = false;
}
</script>

<Dialog bind:open {title} {description} size="wide" flush>
  <div class="grid max-h-[min(70vh,36rem)] grid-rows-[auto_minmax(0,1fr)]">
    <div class="grid gap-2 border-b border-border/50 px-3.5 pt-3 pb-2.5">
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

    <div class="min-h-0 p-1.5">
      {#if models.length === 0 && !hasFallback}
        <p class="px-1 py-2 text-sm text-muted-foreground">
          Authenticate a provider before choosing a model.
        </p>
      {:else if filteredModels.length === 0 && !hasFallback}
        <p class="px-1 py-2 text-sm text-muted-foreground">
          No models match the current filters.
        </p>
      {:else}
        <div class="grid gap-0.5">
          {#if hasFallback}
            <div>
              <button
                type="button"
                class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-transparent px-2 py-1.5 text-left hover:bg-accent/50 aria-pressed:border-primary/60 aria-pressed:bg-primary/8"
                aria-pressed={selectedKey === fallbackKey}
                onclick={() => (selectedKey = fallbackKey)}
              >
                <span class="grid min-w-0 gap-0.5">
                  <span class="truncate text-sm text-foreground"
                    >{fallbackOption?.label}</span
                  >
                  <span class="truncate text-xs text-muted-foreground"
                    >{fallbackOption?.detail}</span
                  >
                </span>
              </button>
            </div>
          {/if}
          <VirtualScroller
            items={filteredModels}
            getKey={(entry) => entry.key}
            estimateSize={() => 48}
            viewportClass="max-h-[min(52vh,24rem)]"
            viewportAriaLabel="Available models"
          >
            {#snippet row({ item: entry })}
              <div>
                <button
                  type="button"
                  class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-transparent px-2 py-1.5 text-left hover:bg-accent/50 aria-pressed:border-primary/60 aria-pressed:bg-primary/8"
                  aria-pressed={selectedKey === entry.key}
                  onclick={() => (selectedKey = entry.key)}
                >
                  <span class="grid min-w-0 gap-0.5">
                    <span class="truncate text-sm text-foreground"
                      >{entry.displayName}</span
                    >
                    <span class="truncate text-xs text-muted-foreground">
                      {entry.providerLabel} ·
                      <span class="font-mono">{entry.model.modelId}</span>
                    </span>
                  </span>
                  <span class="flex-none text-xs text-muted-foreground">
                    {entry.model.reasoning ? "Reasoning" : "Standard"} ·
                    {formatTokens(entry.model.contextWindow)}
                  </span>
                </button>
              </div>
            {/snippet}
          </VirtualScroller>
        </div>
      {/if}
    </div>
  </div>

  {#snippet footer()}
    <div class="flex w-full flex-wrap items-center justify-end gap-2">
      <div
        class="mr-auto flex w-fit max-w-full flex-none flex-wrap items-center gap-2"
      >
        <span
          class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >Thinking level</span
        >
        <ToggleGroup.Root
          type="single"
          size="xs"
          spacing={1}
          variant="outline"
          value={thinkingLevel}
          aria-label="Thinking level"
          class="min-w-0 flex-wrap"
          onValueChange={(value) => {
            if (value) thinkingLevel = value as ThinkingLevel;
          }}
        >
          {#each thinkingLevels as level (level)}
            <ToggleGroup.Item value={level} class="text-xs capitalize"
              >{level}</ToggleGroup.Item
            >
          {/each}
        </ToggleGroup.Root>
      </div>
      <div class="flex flex-none items-center gap-2">
        <Button size="sm" variant="ghost" onclick={() => (open = false)}
          >Cancel</Button
        >
        <Button
          size="sm"
          onclick={save}
          disabled={!hasFallback && !selectedModelInfo}>{confirmLabel}</Button
        >
      </div>
    </div>
  {/snippet}
</Dialog>
