<script lang="ts">
import { untrack } from "svelte";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import { implementationModelCompatible } from "./profile-choice-constraints";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import type {
  AgentRecord,
  ModelInfo,
  PlanReviewResolveOptions,
} from "../../state/tool-types";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { VirtualScroller } from "@nervekit/ui-kit/components/composites/virtual-list";
import { modelKey, parseModelKey } from "$lib/presentation/utils/model";
import {
  buildModelCatalog,
  filterModelCatalog,
  modelProviderFacets,
} from "$lib/presentation/utils/model-catalog";
import {
  clampThinkingLevelForModel,
  supportedThinkingLevelsForModel,
  THINKING_LEVEL_DETAILS,
} from "../../state/thinking-levels";

type ThinkingLevel = NonNullable<AgentRecord["thinkingLevel"]>;

type Props = {
  requirements?: LeadSettingsOverrides;
  open?: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  models: ModelInfo[];
  initialModelKey: string;
  initialThinkingLevel: ThinkingLevel;
  onOpenChange?: (open: boolean) => void;
  onConfirm?: (options: PlanReviewResolveOptions) => void | Promise<void>;
};

let {
  open = $bindable(false),
  title,
  description,
  confirmLabel,
  models,
  initialModelKey,
  initialThinkingLevel,
  onOpenChange,
  onConfirm,
  requirements = {},
}: Props = $props();

let selectionChanged = $state(false);
let selectedModelKey = $state("");
let selectedThinkingLevel = $state<ThinkingLevel>("off");
let query = $state("");
let providerFilter = $state("all");

const catalog = $derived(buildModelCatalog(models));
const providerChips = $derived(modelProviderFacets(catalog));
const filteredModels = $derived(
  filterModelCatalog(catalog, query, providerFilter),
);
const selectedModel = $derived(
  models.find((model) => modelKey(model) === selectedModelKey),
);
const thinkingLevels = $derived(supportedThinkingLevelsForModel(selectedModel));
const confirmDisabled = $derived(!selectedModel);

function thinkingLevelLabel(level: ThinkingLevel): string {
  return level === "off" ? "Off" : level[0].toUpperCase() + level.slice(1);
}

function resetSelection() {
  query = "";
  providerFilter = "all";
  const initialModel = models.find(
    (model) => modelKey(model) === initialModelKey,
  );
  const fallbackModel = initialModel ?? models[0];
  selectedModelKey = fallbackModel ? modelKey(fallbackModel) : "";
  selectedThinkingLevel = clampThinkingLevelForModel(
    initialThinkingLevel,
    fallbackModel,
  );
}

function handleOpenChange(next: boolean) {
  open = next;
  onOpenChange?.(next);
}

function selectModel(model: ModelInfo) {
  if (!implementationModelCompatible(model, requirements) || requirements.model)
    return;
  selectionChanged = true;
  selectedModelKey = modelKey(model);
  selectedThinkingLevel = clampThinkingLevelForModel(
    selectedThinkingLevel,
    model,
  );
}

function selectThinking(level: ThinkingLevel) {
  if (requirements.reasoningLevel !== undefined) return;
  selectionChanged = true;
  selectedThinkingLevel = clampThinkingLevelForModel(level, selectedModel);
}

function confirmSelection() {
  if (
    !selectedModel ||
    !implementationModelCompatible(selectedModel, requirements)
  )
    return;
  const implementationModel = parseModelKey(selectedModelKey);
  if (!implementationModel) return;
  // Capture the selection and close immediately; the parent plan card owns
  // the action's progress and error presentation.
  const options = selectionChanged
    ? {
        implementationModel,
        implementationThinkingLevel: selectedThinkingLevel,
      }
    : {};
  handleOpenChange(false);
  void onConfirm?.(options);
}

$effect(() => {
  if (!open) return;
  // Reinitialize from incoming confirmation only, not from edits to local selection.
  void initialModelKey;
  void initialThinkingLevel;
  void models;
  void requirements;
  untrack(() => {
    resetSelection();
    selectionChanged = false;
    if (requirements.model) selectedModelKey = modelKey(requirements.model);
    if (requirements.reasoningLevel !== undefined)
      selectedThinkingLevel = requirements.reasoningLevel;
    else
      selectedThinkingLevel = clampThinkingLevelForModel(
        selectedThinkingLevel,
        models.find((m) => modelKey(m) === selectedModelKey),
      );
  });
});
</script>

<DialogShell
  {open}
  {title}
  {description}
  onOpenChange={handleOpenChange}
  class="max-w-xl"
>
  <div class="grid gap-3">
    <section class="grid gap-2">
      <p
        class="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        Model
      </p>
      {#if models.length === 0}
        <p
          class="m-0 rounded-md border border-dashed border-border bg-muted p-3 text-sm text-muted-foreground"
        >
          No models available. Configure a provider or adjust Scoped Models in
          Settings.
        </p>
      {:else}
        <div class="grid gap-2">
          <SearchInput
            bind:value={query}
            placeholder="Search models"
            ariaLabel="Search models"
          />
          {#if providerChips.length > 2}
            <ToggleGroup.Root
              type="single"
              size="sm"
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
          {#if filteredModels.length === 0}
            <p class="m-0 px-1 py-2 text-sm text-muted-foreground">
              No models match the current filters.
            </p>
          {:else}
            <VirtualScroller
              items={filteredModels}
              getKey={(entry) => entry.key}
              estimateSize={() => 38}
              viewportClass="max-h-[min(45vh,20rem)]"
              viewportAriaLabel="Implementation model"
            >
              {#snippet row({ item: entry })}
                {@const active = entry.key === selectedModelKey}
                <button
                  type="button"
                  class={`flex w-full items-center justify-between gap-3 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors disabled:opacity-50 ${
                    active
                      ? "border-primary/40 bg-selected text-foreground"
                      : "border-transparent text-foreground hover:bg-accent"
                  }`}
                  aria-selected={active}
                  role="option"
                  disabled={!!requirements.model ||
                    !implementationModelCompatible(entry.model, requirements)}
                  onclick={() => selectModel(entry.model)}
                >
                  <span class="min-w-0 truncate font-medium"
                    >{entry.contextualLabel}</span
                  >
                  {#if active}<CircleCheck
                      class="size-4"
                      strokeWidth={2.4}
                    />{/if}
                </button>
              {/snippet}
            </VirtualScroller>
          {/if}
        </div>
      {/if}
    </section>

    {#if selectedModel}
      <section class="grid gap-2 border-t border-border/60 pt-3">
        <p
          class="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Thinking level
        </p>
        <div
          class="flex flex-wrap gap-2"
          role="group"
          aria-label="Implementation thinking level"
        >
          {#each thinkingLevels as level (level)}
            {@const active = level === selectedThinkingLevel}
            <button
              type="button"
              class={`rounded-md border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                active
                  ? "border-primary bg-selected text-foreground"
                  : "border-border bg-input text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
              disabled={requirements.reasoningLevel !== undefined}
              aria-pressed={active}
              title={THINKING_LEVEL_DETAILS[level]}
              onclick={() => selectThinking(level)}
            >
              {thinkingLevelLabel(level)}
            </button>
          {/each}
        </div>
      </section>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => handleOpenChange(false)}
      >Cancel</Button
    >
    <Button
      onclick={confirmSelection}
      disabled={confirmDisabled ||
        !selectedModel ||
        !implementationModelCompatible(selectedModel, requirements)}
      >{confirmLabel}</Button
    >
  {/snippet}
</DialogShell>
