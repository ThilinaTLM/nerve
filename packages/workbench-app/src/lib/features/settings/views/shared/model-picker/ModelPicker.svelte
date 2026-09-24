<!--
  Single-model picker for settings. A field-like trigger opens an anchored
  popover with search, provider and capability filters and a virtual list.
  Choosing a row applies immediately and keeps the popover open so the inline
  reasoning level can follow; Enter chooses the highlighted row and closes.
-->
<script lang="ts">
import { untrack } from "svelte";
import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { ModelInfo, ModelSelection, ThinkingLevel } from "$lib/api";
import Popover, {
  createListNavigation,
  PopoverBody,
  PopoverHeader,
  PopoverSearch,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import {
  VirtualScroller,
  type VirtualScrollerController,
} from "@nervekit/ui-kit/components/composites/virtual-list";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { cn } from "@nervekit/ui-kit/utils";
import {
  clampThinkingLevelForModel,
  supportedThinkingLevelsForModel,
} from "$lib/application/preferences/agent-selection";
import {
  buildModelCatalog,
  filterModelCatalog,
  modelSupportsReasoning,
  type ModelCapability,
} from "$lib/presentation/utils/model-catalog";
import ModelCatalogFilters from "./ModelCatalogFilters.svelte";
import ModelCatalogRow from "./ModelCatalogRow.svelte";
import {
  pickerListItems,
  resolvePickerValue,
  type PickerListItem,
} from "./model-picker";

type Props = {
  /** Accessible name of the setting, e.g. "Explore model". */
  label: string;
  /** Usable models; required capabilities are applied here. */
  models: ModelInfo[];
  /** `undefined` means no model is chosen yet. */
  value: ModelSelection | undefined;
  /** `undefined` means the level is not set yet (nothing highlighted). */
  thinkingLevel: ThinkingLevel | undefined;
  onChange: (next: {
    model?: ModelSelection;
    thinkingLevel: ThinkingLevel;
  }) => void;
  requiredCapabilities?: ModelCapability[];
  showReasoning?: boolean;
  size?: "xs" | "sm";
  class?: string;
  tourId?: string;
  emptyMessage?: string;
  disabled?: boolean;
};

let {
  label,
  models,
  value,
  thinkingLevel,
  onChange,
  requiredCapabilities = [],
  showReasoning = true,
  size = "sm",
  class: className,
  tourId,
  emptyMessage = "Authenticate a provider before choosing a model.",
  disabled = false,
}: Props = $props();

const uid = $props.id();
const listId = `${uid}-models`;

let open = $state(false);
let query = $state("");
let provider = $state("all");
let capabilities = $state<ModelCapability[]>([]);
let controller = $state<VirtualScrollerController>();

const catalog = $derived(
  filterModelCatalog(
    buildModelCatalog(models),
    "",
    "all",
    new Set(requiredCapabilities),
  ),
);
const resolved = $derived(resolvePickerValue(catalog, value));
const items = $derived(
  pickerListItems({
    entries: catalog,
    query,
    provider,
    capabilities: new Set(capabilities),
    resolved,
  }),
);
const modelCount = $derived(
  items.filter((item) => item.kind === "model").length,
);
const selectedKey = $derived(
  resolved.kind === "available"
    ? resolved.entry.key
    : resolved.kind === "unavailable"
      ? items.find((item) => item.kind === "unavailable")?.key
      : undefined,
);
const selectedModel = $derived(
  resolved.kind === "available" ? resolved.entry.model : undefined,
);
/** The selected model's reasoning levels are pinned under the list so the
 * control keeps one place regardless of scroll position or filters. */
const reasoningModel = $derived(
  showReasoning && selectedModel && modelSupportsReasoning(selectedModel)
    ? selectedModel
    : undefined,
);
const reasoningModelLabel = $derived(
  resolved.kind === "available" ? resolved.entry.contextualLabel : "",
);
const showLevel = $derived(
  showReasoning &&
    selectedModel !== undefined &&
    modelSupportsReasoning(selectedModel) &&
    thinkingLevel !== undefined &&
    thinkingLevel !== "off",
);

const triggerTitle = $derived(
  resolved.kind === "available"
    ? `${label}: ${resolved.entry.displayName} · ${resolved.entry.providerLabel}${showLevel ? ` · ${thinkingLevel} reasoning` : ""}`
    : resolved.kind === "unavailable"
      ? `${label}: ${resolved.selection.provider}/${resolved.selection.modelId} is unavailable`
      : label,
);

const navigation = createListNavigation({
  items: () => items,
  getId: rowId,
  onChoose: (item) => choose(item, true),
});

$effect(() => {
  const index = navigation.index;
  if (index >= 0) controller?.scrollToIndex(index, { align: "auto" });
});

// Bring the current value into view each time the list mounts.
$effect(() => {
  if (!open || !controller) return;
  const list = controller;
  const index = untrack(() =>
    items.findIndex((item) => item.key === selectedKey),
  );
  if (index > 0) {
    requestAnimationFrame(() => list.scrollToIndex(index, { align: "center" }));
  }
});

$effect(() => {
  if (disabled) open = false;
});

function rowId(item: PickerListItem): string {
  return `${uid}-row-${encodeURIComponent(item.key)}`;
}

function handleOpenChange(next: boolean): void {
  open = disabled ? false : next;
  if (open) {
    controller = undefined;
    query = "";
    provider = "all";
    capabilities = [...requiredCapabilities];
  }
  navigation.reset();
}

function choose(item: PickerListItem, close = false): void {
  if (item.kind === "model" && item.key !== selectedKey) {
    onChange({
      model: {
        provider: item.entry.model.provider,
        modelId: item.entry.model.modelId,
      },
      thinkingLevel: clampThinkingLevelForModel(
        thinkingLevel ?? "off",
        item.entry.model,
      ),
    });
  }
  if (close) open = false;
}

function chooseLevel(model: ModelInfo, level: ThinkingLevel): void {
  if (level === thinkingLevel) return;
  onChange({
    model: { provider: model.provider, modelId: model.modelId },
    thinkingLevel: level,
  });
}

function handleSearchKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter") {
    event.preventDefault();
    navigation.chooseActive();
    return;
  }
  navigation.handleKeydown(event);
}
</script>

<Popover
  {open}
  onOpenChange={handleOpenChange}
  size="lg"
  align="end"
  ariaLabel={label}
  {triggerTitle}
  triggerClass={cn(
    "flex min-w-0 justify-start gap-1.5 rounded-md border border-input pr-1.5 pl-2 text-left text-sm shadow-xs transition-colors hover:bg-accent/50 data-[state=open]:ring-3 data-[state=open]:ring-ring/50 dark:bg-input/30",
    size === "xs" ? "h-6" : "h-7",
    disabled && "pointer-events-none opacity-50",
    className,
  )}
>
  {#snippet trigger()}
    <span
      class="flex min-w-0 flex-1 items-baseline gap-1.5"
      data-tour-id={tourId}
    >
      {#if resolved.kind === "available"}
        <span class="truncate text-foreground"
          >{resolved.entry.contextualLabel}</span
        >
      {:else if resolved.kind === "unavailable"}
        <TriangleAlert
          class="size-3.5 flex-none self-center text-warning"
          aria-hidden="true"
        />
        <span class="truncate text-foreground"
          >{resolved.selection.modelId}</span
        >
        <span class="flex-none text-xs text-warning">Unavailable</span>
      {:else}
        <span class="truncate text-muted-foreground">Choose model</span>
      {/if}
    </span>
    {#if showLevel}
      <Badge variant="accent" class="capitalize">{thinkingLevel}</Badge>
    {/if}
    <ChevronsUpDown
      class="size-3.5 flex-none text-muted-foreground"
      aria-hidden="true"
    />
  {/snippet}

  <PopoverHeader title={label} meta={`${modelCount} of ${catalog.length}`} />
  <PopoverSearch>
    <ModelCatalogFilters
      entries={catalog}
      bind:query
      bind:provider
      bind:capabilities
      {requiredCapabilities}
      onSearchKeydown={handleSearchKeydown}
      controls={listId}
      activeDescendant={navigation.activeDescendant}
    />
  </PopoverSearch>

  <PopoverBody>
    <Tooltip.Provider delayDuration={300} disableHoverableContent>
      {#if catalog.length === 0 && resolved.kind !== "unavailable"}
        <p class="px-1.5 text-muted-foreground">{emptyMessage}</p>
      {:else if items.length === 0}
        <p class="px-1.5 text-muted-foreground">No models match.</p>
      {:else}
        <div id={listId} role="listbox" aria-label={label}>
          <VirtualScroller
            {items}
            bind:controller
            getKey={(item) => item.key}
            estimateSize={() => 30}
            gap={1}
            viewportClass="max-h-[min(50vh,20rem)]"
          >
            {#snippet row({ item, index })}
              {#if item.kind === "unavailable"}
                <ModelCatalogRow
                  id={rowId(item)}
                  label={`${item.selection.provider}/${item.selection.modelId}`}
                  selected
                  disabled
                  active={navigation.isActive(index)}
                >
                  {#snippet trailing()}
                    <Badge variant="warning">Unavailable</Badge>
                  {/snippet}
                </ModelCatalogRow>
              {:else}
                {@const entry = item.entry}
                {@const selected = item.key === selectedKey}
                <ModelCatalogRow
                  id={rowId(item)}
                  label={entry.displayName}
                  detail={entry.providerLabel}
                  title={`${entry.model.provider}/${entry.model.modelId}`}
                  model={entry.model}
                  {selected}
                  active={navigation.isActive(index)}
                  onclick={() => choose(item)}
                ></ModelCatalogRow>
              {/if}
            {/snippet}
          </VirtualScroller>
        </div>
      {/if}
    </Tooltip.Provider>
  </PopoverBody>

  {#if reasoningModel}
    <section
      class="grid flex-none gap-1 border-t border-border px-2 pt-1.5 pb-2"
      aria-label="Reasoning level"
    >
      <span class="px-1.5 text-xs text-muted-foreground"
        >Reasoning · {reasoningModelLabel}</span
      >
      <ToggleGroup.Root
        type="single"
        size="xs"
        spacing={1}
        variant="chip"
        value={thinkingLevel}
        aria-label={`${label} reasoning level`}
        class="flex-wrap justify-start"
        onValueChange={(next) => {
          if (next) chooseLevel(reasoningModel, next as ThinkingLevel);
        }}
      >
        {#each supportedThinkingLevelsForModel(reasoningModel) as level (level)}
          <ToggleGroup.Item value={level} class="flex-none capitalize"
            >{level}</ToggleGroup.Item
          >
        {/each}
      </ToggleGroup.Root>
    </section>
  {/if}
</Popover>
