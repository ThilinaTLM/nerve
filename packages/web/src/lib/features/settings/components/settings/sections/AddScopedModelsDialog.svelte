<script lang="ts">
  import Search from "@lucide/svelte/icons/search";
  import type { AuthProviderMetadata, ModelInfo, ModelSelection } from "$lib/api";
  import { Button } from "@nervekit/shared-ui/components/ui/button";
  import { Checkbox } from "@nervekit/shared-ui/components/ui/checkbox";
  import Dialog from "@nervekit/shared-ui/components/ui/dialog-shell";
  import { Input } from "@nervekit/shared-ui/components/ui/input";
  import {
    authenticatedRealModelOptions,
    modelDisplayName,
    modelKey,
    providerDisplayName,
  } from "@nervekit/shared-ui/core/utils/model";

  type ProviderChip = { id: string; label: string; count: number };

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

  const providerChips = $derived.by<ProviderChip[]>(() => {
    const counts = new Map<string, number>();
    for (const model of availableModels) {
      counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
    }
    const chips = [...counts.entries()]
      .map(([id, count]) => ({ id, label: providerDisplayName(id), count }))
      .sort((left, right) => left.label.localeCompare(right.label));
    return [
      { id: "all", label: "All", count: availableModels.length },
      ...chips,
    ];
  });

  const filteredModels = $derived.by<ModelInfo[]>(() => {
    const needle = query.trim().toLowerCase();
    return [...availableModels]
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

  const selectedCount = $derived(selectedKeys.size);

  function toggleModel(model: ModelInfo, checked: boolean) {
    const next = new Set(selectedKeys);
    const key = modelKey(model);
    if (checked) next.add(key);
    else next.delete(key);
    selectedKeys = next;
  }

  function save() {
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
  class="scoped-models-dialog"
>
  <div class="scoped-dialog-body">
    <div class="scoped-dialog-toolbar">
      <div class="scoped-dialog-search">
        <Search size={15} strokeWidth={2} aria-hidden="true" />
        <Input
          type="search"
          placeholder="Search models"
          bind:value={query}
          aria-label="Search models"
          class="rounded-sm"
        />
      </div>
      {#if availableModels.length > 0}
        <div class="scoped-dialog-providers" role="group" aria-label="Filter by provider">
          {#each providerChips as chip (chip.id)}
            <button
              type="button"
              class="scoped-chip"
              class:active={providerFilter === chip.id}
              aria-pressed={providerFilter === chip.id}
              onclick={() => (providerFilter = chip.id)}
            >
              {chip.label}
              <span class="scoped-chip-count">{chip.count}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="scoped-dialog-content">
      {#if availableModels.length === 0}
        <p class="scoped-dialog-empty">Authenticate a provider before choosing scoped models.</p>
      {:else if filteredModels.length === 0}
        <p class="scoped-dialog-empty">No models match the current filters.</p>
      {:else}
        <ul class="scoped-dialog-list">
          {#each filteredModels as model (modelKey(model))}
            {@const checked = selectedKeys.has(modelKey(model))}
            <li>
              <label class="scoped-dialog-row" class:selected={checked}>
                <Checkbox
                  {checked}
                  onCheckedChange={(value) => toggleModel(model, value === true)}
                  aria-label={modelDisplayName(model)}
                />
                <span class="scoped-dialog-row-text">
                  <strong>{modelDisplayName(model)}</strong>
                  <span>{providerDisplayName(model.provider)} · {model.modelId}</span>
                </span>
              </label>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>

  {#snippet footer()}
    <span class="scoped-dialog-count">
      {selectedCount === 0 ? "All models available" : `${selectedCount} selected`}
    </span>
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button onclick={save} disabled={availableModels.length === 0}>Save selection</Button>
  {/snippet}
</Dialog>

<style>
  .scoped-dialog-body {
    display: grid;
    align-content: start;
  }

  .scoped-dialog-toolbar {
    position: sticky;
    top: 0;
    z-index: 2;
    display: grid;
    gap: 0.6rem;
    background: var(--card);
    border-bottom: 1px solid color-mix(in oklab, var(--border) 50%, transparent);
    padding: 0.9rem 1.1rem 0.7rem;
  }

  .scoped-dialog-search {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--muted-foreground);
  }

  .scoped-dialog-providers {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .scoped-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid color-mix(in oklab, var(--border) 55%, transparent);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted-foreground);
    padding: 0.26rem 0.6rem;
    font-size: var(--text-xs);
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  .scoped-chip:hover {
    background: color-mix(in oklab, var(--accent) 45%, transparent);
    color: var(--foreground);
  }

  .scoped-chip.active {
    border-color: var(--primary);
    background: color-mix(in oklab, var(--accent) 35%, transparent);
    color: var(--foreground);
  }

  .scoped-chip-count {
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }

  .scoped-chip.active .scoped-chip-count {
    color: var(--foreground);
  }

  .scoped-dialog-content {
    padding: 0.7rem 1.1rem 1rem;
  }

  .scoped-dialog-empty {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
  }

  .scoped-dialog-list {
    display: grid;
    gap: 0.2rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .scoped-dialog-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    padding: 0.42rem 0.5rem;
    cursor: pointer;
  }

  .scoped-dialog-row:hover {
    background: color-mix(in oklab, var(--accent) 45%, transparent);
  }

  .scoped-dialog-row.selected {
    border-color: color-mix(in oklab, var(--primary) 45%, transparent);
    background: color-mix(in oklab, var(--accent) 35%, transparent);
  }

  .scoped-dialog-row-text {
    display: grid;
    min-width: 0;
    gap: 0.06rem;
  }

  .scoped-dialog-row-text strong {
    color: var(--foreground);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .scoped-dialog-row-text span {
    overflow: hidden;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scoped-dialog-count {
    margin-right: auto;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }
</style>
