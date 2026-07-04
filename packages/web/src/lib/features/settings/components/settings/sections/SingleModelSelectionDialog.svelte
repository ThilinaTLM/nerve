<script lang="ts">
  import Search from "@lucide/svelte/icons/search";
  import type {
    AuthProviderMetadata,
    ModelInfo,
    ModelSelection,
    ThinkingLevel,
  } from "$lib/api";
  import { Button } from "@nervekit/ui/components/ui/button";
  import Dialog from "@nervekit/ui/components/ui/dialog-shell";
  import { Input } from "@nervekit/ui/components/ui/input";
  import {
    modelDisplayName,
    modelKey,
    providerDisplayName,
  } from "$lib/core/utils/model";

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
  const thinkingItems = $derived(
    thinkingLevels.map((level) => ({ value: level, label: level })),
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
    const counts = new Map<string, number>();
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
        return provider || modelDisplayName(left).localeCompare(modelDisplayName(right));
      });
  });

  function formatTokens(tokens: number): string {
    if (tokens <= 0) return "Unknown context";
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M context`;
    if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K context`;
    return `${tokens.toLocaleString()} context`;
  }

  function selectModel(key: string) {
    selectedKey = key;
  }

  function save() {
    const model = selectedModelInfo
      ? { provider: selectedModelInfo.provider, modelId: selectedModelInfo.modelId }
      : undefined;
    onSave?.({ model, thinkingLevel });
    open = false;
  }
</script>

<Dialog bind:open {title} {description} class="single-model-dialog">
  <div class="single-model-dialog-body">
    <div class="single-model-toolbar">
      <div class="single-model-search">
        <Search
          class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          placeholder="Search models"
          bind:value={query}
          aria-label="Search models"
          class="rounded-sm pl-8"
        />
      </div>
      {#if models.length > 0}
        <div class="single-model-providers" role="group" aria-label="Filter by provider">
          {#each providerChips as chip (chip.id)}
            <button
              type="button"
              class="single-model-chip"
              class:active={providerFilter === chip.id}
              aria-pressed={providerFilter === chip.id}
              onclick={() => (providerFilter = chip.id)}
            >
              {chip.label}
              <span>{chip.count}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="single-model-content">
      {#if models.length === 0 && !hasFallback}
        <p class="single-model-empty">Authenticate a provider before choosing a model.</p>
      {:else if filteredModels.length === 0 && !hasFallback}
        <p class="single-model-empty">No models match the current filters.</p>
      {:else}
        <ul class="single-model-list">
          {#if hasFallback}
            <li>
              <button
                type="button"
                class="single-model-row"
                class:selected={selectedKey === fallbackKey}
                aria-pressed={selectedKey === fallbackKey}
                onclick={() => selectModel(fallbackKey)}
              >
                <span class="single-model-row-text">
                  <strong>{fallbackOption?.label}</strong>
                  <span>{fallbackOption?.detail}</span>
                </span>
              </button>
            </li>
          {/if}
          {#each filteredModels as model (modelKey(model))}
            {@const key = modelKey(model)}
            {@const selected = selectedKey === key}
            <li>
              <button
                type="button"
                class="single-model-row"
                class:selected
                aria-pressed={selected}
                onclick={() => selectModel(key)}
              >
                <span class="single-model-row-text">
                  <strong>{modelDisplayName(model)}</strong>
                  <span>{providerDisplayName(model.provider)} · {model.modelId}</span>
                </span>
                <span class="single-model-row-meta">
                  {model.reasoning ? "Reasoning" : "Standard"} · {formatTokens(model.contextWindow)}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

  </div>

  {#snippet footer()}
    <div class="single-model-thinking">
      <span class="single-model-thinking-label">Thinking level</span>
      <div class="single-model-thinking-chips" role="group" aria-label="Thinking level">
        {#each thinkingItems as item (item.value)}
          <button
            type="button"
            class="single-model-thinking-chip"
            class:active={thinkingLevel === item.value}
            aria-pressed={thinkingLevel === item.value}
            onclick={() => (thinkingLevel = item.value)}
          >
            {item.label}
          </button>
        {/each}
      </div>
    </div>
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button onclick={save} disabled={!hasFallback && !selectedModelInfo}>{confirmLabel}</Button>
  {/snippet}
</Dialog>

<style>
  :global(.single-model-dialog) {
    width: min(820px, calc(100vw - 32px));
  }

  .single-model-dialog-body {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: min(70vh, 36rem);
  }

  .single-model-toolbar {
    display: grid;
    gap: 0.6rem;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 50%, transparent);
    background: var(--card);
    padding: 0.9rem 1.1rem 0.7rem;
  }

  .single-model-search {
    position: relative;
    display: block;
  }

  .single-model-providers {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .single-model-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid color-mix(in oklab, var(--border) 55%, transparent);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
    padding: 0.26rem 0.6rem;
    font-size: var(--text-xs);
    font-weight: 500;
    white-space: nowrap;
  }

  .single-model-chip:hover {
    background: color-mix(in oklab, var(--accent) 45%, transparent);
    color: var(--foreground);
  }

  .single-model-chip.active {
    border-color: var(--primary);
    background: color-mix(in oklab, var(--accent) 35%, transparent);
    color: var(--foreground);
  }

  .single-model-content {
    overflow-y: auto;
    min-height: 0;
    padding: 0.7rem 1.1rem;
  }

  .single-model-empty {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
  }

  .single-model-list {
    display: grid;
    gap: 0.2rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .single-model-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    width: 100%;
    gap: 0.65rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0.55rem 0.65rem;
    text-align: left;
  }

  .single-model-row:hover {
    background: color-mix(in oklab, var(--accent) 45%, transparent);
  }

  .single-model-row.selected {
    border-color: var(--primary);
    background: color-mix(in oklab, var(--primary) 14%, transparent);
  }

  .single-model-row-text {
    display: grid;
    min-width: 0;
    gap: 0.06rem;
  }

  .single-model-row-text strong {
    color: var(--foreground);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .single-model-row-text span,
  .single-model-row-meta {
    overflow: hidden;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .single-model-row-text span {
    font-family: var(--font-mono);
  }

  .single-model-thinking {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    margin-right: auto;
  }

  .single-model-thinking-label {
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .single-model-thinking-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .single-model-thinking-chip {
    border: 1px solid color-mix(in oklab, var(--border) 55%, transparent);
    border-radius: 999px;
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
    padding: 0.2rem 0.7rem;
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: capitalize;
  }

  .single-model-thinking-chip:hover {
    background: color-mix(in oklab, var(--accent) 45%, transparent);
    color: var(--foreground);
  }

  .single-model-thinking-chip.active {
    border-color: var(--primary);
    background: color-mix(in oklab, var(--primary) 16%, transparent);
    color: var(--foreground);
  }


  @media (max-width: 760px) {
    .single-model-row {
      grid-template-columns: auto minmax(0, 1fr);
    }

    .single-model-row-meta {
      grid-column: 2;
    }
  }
</style>
