<script lang="ts">
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import type { AuthProviderMetadata, ModelInfo, ModelSelection } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import SearchInput from "@nervekit/ui-kit/components/ui/search-input";
import { Checkbox } from "@nervekit/ui-kit/components/ui/checkbox";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import {
  authenticatedRealModelOptions,
  modelDisplayName,
  modelKey,
  providerDisplayName,
} from "$lib/presentation/utils/model";

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
  const counts = new SvelteMap<string, number>();
  for (const model of availableModels) {
    counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
  }
  const chips = [...counts.entries()]
    .map(([id, count]) => ({ id, label: providerDisplayName(id), count }))
    .sort((left, right) => left.label.localeCompare(right.label));
  return [{ id: "all", label: "All", count: availableModels.length }, ...chips];
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
      return (
        provider ||
        modelDisplayName(left).localeCompare(modelDisplayName(right))
      );
    });
});

const selectedCount = $derived(selectedKeys.size);

function toggleModel(model: ModelInfo, checked: boolean): void {
  const next = new SvelteSet(selectedKeys);
  const key = modelKey(model);
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
>
  <div class="grid max-h-[min(70vh,32rem)] grid-rows-[auto_minmax(0,1fr)]">
    <div class="grid gap-2 border-b border-border/50 pb-3">
      <SearchInput
        bind:value={query}
        placeholder="Search models"
        ariaLabel="Search models"
      />
      {#if availableModels.length > 0}
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
      {#if availableModels.length === 0}
        <p class="text-sm text-muted-foreground">
          Authenticate a provider before choosing scoped models.
        </p>
      {:else if filteredModels.length === 0}
        <p class="text-sm text-muted-foreground">
          No models match the current filters.
        </p>
      {:else}
        <ul class="grid gap-0.5" aria-label="Authenticated models">
          {#each filteredModels as model (modelKey(model))}
            {@const checked = selectedKeys.has(modelKey(model))}
            <li>
              <Label
                class="flex cursor-pointer items-center gap-3 rounded-md border border-transparent px-2.5 py-2 font-normal hover:bg-accent/50 has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-accent"
              >
                <Checkbox
                  {checked}
                  onCheckedChange={(value) =>
                    toggleModel(model, value === true)}
                  aria-label={modelDisplayName(model)}
                />
                <span class="grid min-w-0 gap-0.5">
                  <span class="truncate text-sm text-foreground"
                    >{modelDisplayName(model)}</span
                  >
                  <span class="truncate text-xs text-muted-foreground">
                    {providerDisplayName(model.provider)} ·
                    <span class="font-mono">{model.modelId}</span>
                  </span>
                </span>
              </Label>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>

  {#snippet footer()}
    <span class="mr-auto text-xs text-muted-foreground">
      {selectedCount === 0
        ? "All models available"
        : `${selectedCount} selected`}
    </span>
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button onclick={save} disabled={availableModels.length === 0}
      >Save selection</Button
    >
  {/snippet}
</Dialog>
