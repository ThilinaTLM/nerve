<script lang="ts">
import { SvelteMap } from "svelte/reactivity";
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
import {
  modelDisplayName,
  modelKey,
  providerDisplayName,
} from "$lib/presentation/utils/model";

type ProviderChip = { id: string; label: string; count: number };
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

const providerChips = $derived.by<ProviderChip[]>(() => {
  const counts = new SvelteMap<string, number>();
  for (const model of models) {
    counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
  }
  const chips = [...counts.entries()]
    .map(([id, count]) => ({ id, label: providerDisplayName(id), count }))
    .sort((left, right) => left.label.localeCompare(right.label));
  return [{ id: "all", label: "All", count: models.length }, ...chips];
});

const filteredModels = $derived.by<ModelInfo[]>(() => {
  const needle = query.trim().toLowerCase();
  return [...models]
    .filter((model) => {
      if (providerFilter !== "all" && model.provider !== providerFilter) {
        return false;
      }
      if (!needle) return true;
      const haystack =
        `${modelDisplayName(model)} ${model.modelId} ${providerDisplayName(model.provider)}`.toLowerCase();
      return haystack.includes(needle);
    })
    .sort((left, right) => {
      const provider = providerDisplayName(left.provider).localeCompare(
        providerDisplayName(right.provider),
      );
      return (
        provider ||
        modelDisplayName(left).localeCompare(modelDisplayName(right))
      );
    });
});

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

<Dialog bind:open {title} {description} size="wide">
  <div class="grid max-h-[min(70vh,36rem)] grid-rows-[auto_minmax(0,1fr)]">
    <div class="grid gap-2 border-b border-border/50 pb-3">
      <SearchInput
        bind:value={query}
        placeholder="Search models"
        ariaLabel="Search models"
      />
      {#if models.length > 0}
        <ToggleGroup.Root
          type="single"
          size="sm"
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

    <div class="min-h-0 overflow-y-auto pt-2">
      {#if models.length === 0 && !hasFallback}
        <p class="text-sm text-muted-foreground">
          Authenticate a provider before choosing a model.
        </p>
      {:else if filteredModels.length === 0 && !hasFallback}
        <p class="text-sm text-muted-foreground">
          No models match the current filters.
        </p>
      {:else}
        <ul class="grid gap-0.5" aria-label="Available models">
          {#if hasFallback}
            <li>
              <button
                type="button"
                class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-transparent px-2.5 py-2 text-left hover:bg-accent/50 aria-pressed:border-primary aria-pressed:bg-accent"
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
            </li>
          {/if}
          {#each filteredModels as model (modelKey(model))}
            {@const key = modelKey(model)}
            <li>
              <button
                type="button"
                class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-transparent px-2.5 py-2 text-left hover:bg-accent/50 aria-pressed:border-primary aria-pressed:bg-accent"
                aria-pressed={selectedKey === key}
                onclick={() => (selectedKey = key)}
              >
                <span class="grid min-w-0 gap-0.5">
                  <span class="truncate text-sm text-foreground"
                    >{modelDisplayName(model)}</span
                  >
                  <span class="truncate text-xs text-muted-foreground">
                    {providerDisplayName(model.provider)} ·
                    <span class="font-mono">{model.modelId}</span>
                  </span>
                </span>
                <span class="flex-none text-xs text-muted-foreground">
                  {model.reasoning ? "Reasoning" : "Standard"} · {formatTokens(
                    model.contextWindow,
                  )}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>

  {#snippet footer()}
    <div class="mr-auto flex flex-wrap items-center gap-2">
      <span
        class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >Thinking level</span
      >
      <ToggleGroup.Root
        type="single"
        size="sm"
        spacing={1}
        variant="outline"
        value={thinkingLevel}
        aria-label="Thinking level"
        class="flex-wrap"
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
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button onclick={save} disabled={!hasFallback && !selectedModelInfo}
      >{confirmLabel}</Button
    >
  {/snippet}
</Dialog>
