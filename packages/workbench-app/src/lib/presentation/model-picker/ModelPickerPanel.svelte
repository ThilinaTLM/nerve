<script lang="ts">
import { onMount, untrack } from "svelte";
import Lock from "@lucide/svelte/icons/lock";
import type {
  ModelInfo,
  ModelSelection,
  ThinkingLevel,
} from "@nervekit/contracts/models";
import {
  createListNavigation,
  PopoverBody,
  PopoverSearch,
  usePopoverPresentation,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import {
  VirtualScroller,
  type VirtualScrollerController,
} from "@nervekit/ui-kit/components/composites/virtual-list";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import {
  THINKING_LEVEL_DETAILS,
  clampThinkingLevelForModel,
  supportedThinkingLevelsForModel,
} from "$lib/presentation/state/thinking-levels";
import {
  buildModelCatalog,
  filterModelCatalog,
  modelSupportsReasoning,
  modelCapabilityLabels,
  type ModelCapability,
} from "$lib/presentation/utils/model-catalog";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import ModelCatalogRow from "./ModelCatalogRow.svelte";
import {
  INHERIT_PICKER_KEY,
  pickerListItems,
  pickerNavigableItems,
  resolvePickerValue,
  type PickerListItem,
} from "./model-picker";

type Props = {
  /** Accessible name of the setting, e.g. "Image explanation model". */
  label?: string;
  /** Called when a choice should close the containing popover. */
  onChoose?: () => void;
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
  emptyMessage?: string;
  /** The model half is locked: visible and readable, but not changeable. */
  modelDisabled?: boolean;
  /** The reasoning half is locked; the model can still change. */
  thinkingDisabled?: boolean;
  /** Why a half is locked, shown as a tooltip on its lock icon. */
  lockReason?: string;
  /** Offers a first row that defers to the parent agent's model. */
  inheritOption?: { label: string; description: string };
  /** The parent's model is in use; `value` keeps the last explicit choice. */
  inherit?: boolean;
  onInherit?: () => void;
  /** Optional independent reasoning editor, including an unset/inherited level. */
  onThinkingChange?: (level: ThinkingLevel | undefined) => void;
  isModelCompatible?: (model: ModelInfo) => boolean;
};

let {
  label = "Model",
  onChoose,
  models,
  value,
  thinkingLevel,
  onChange,
  requiredCapabilities = [],
  showReasoning = true,
  emptyMessage = "Authenticate a provider before choosing a model.",
  modelDisabled = false,
  thinkingDisabled = false,
  lockReason,
  inheritOption,
  inherit = false,
  onInherit,
  onThinkingChange,
  isModelCompatible = () => true,
}: Props = $props();

const uid = $props.id();
const listId = `${uid}-models`;

let query = $state("");
let controller = $state<VirtualScrollerController>();

const catalog = $derived(
  filterModelCatalog(
    buildModelCatalog(models),
    "",
    "all",
    new Set(requiredCapabilities),
  ),
);
const inheriting = $derived(Boolean(inheritOption) && inherit);
const resolved = $derived(
  resolvePickerValue(catalog, inheriting ? undefined : value),
);
const items = $derived(
  pickerListItems({
    entries: catalog,
    query,
    resolved,
    offerInherit: Boolean(inheritOption),
  }),
);
const selectedKey = $derived(
  inheriting
    ? INHERIT_PICKER_KEY
    : resolved.kind === "available"
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
const reasoningLevels = $derived(
  reasoningModel ? supportedThinkingLevelsForModel(reasoningModel) : [],
);
const reasoningModelLabel = $derived(
  resolved.kind === "available" ? resolved.entry.contextualLabel : "",
);
const unsupportedReasoning = $derived(
  showReasoning &&
    !inheriting &&
    selectedModel !== undefined &&
    thinkingLevel !== undefined &&
    !supportedThinkingLevelsForModel(selectedModel).includes(thinkingLevel),
);
const lockTitle = $derived(
  lockReason ??
    (modelDisabled && thinkingDisabled
      ? "Locked"
      : modelDisabled
        ? "Model is locked"
        : "Reasoning level is locked"),
);
const navigableItems = $derived(pickerNavigableItems(items));
const navigation = createListNavigation({
  items: () => navigableItems,
  getId: rowId,
  onChoose: (item) => choose(item, true),
});

$effect(() => {
  const active = navigableItems[navigation.index];
  const index = active
    ? items.findIndex((item) => item.key === active.key)
    : -1;
  if (index >= 0) controller?.scrollToIndex(index, { align: "auto" });
});

// Bring the current value into view each time the list mounts.
$effect(() => {
  if (!controller) return;
  const list = controller;
  const index = untrack(() =>
    items.findIndex((item) => item.key === selectedKey),
  );
  if (index > 0) {
    requestAnimationFrame(() => list.scrollToIndex(index, { align: "center" }));
  }
});

let searchRef = $state<HTMLInputElement | null>(null);
const presentation = usePopoverPresentation();
// In a sheet, focusing search would raise the on-screen keyboard.
onMount(() => {
  if (presentation() !== "sheet") searchRef?.focus();
});
$effect(() => {
  void query;
  navigation.reset();
});

function rowId(item: PickerListItem): string {
  return `${uid}-row-${encodeURIComponent(item.key)}`;
}

function choose(item: PickerListItem, close = false): void {
  if (modelDisabled) return;
  if (item.kind === "inherit") {
    if (!inheriting) onInherit?.();
    if (!onThinkingChange || close) onChoose?.();
    return;
  }
  if (
    item.kind === "model" &&
    (!isModelCompatible(item.entry.model) ||
      (thinkingDisabled &&
        thinkingLevel !== undefined &&
        !supportedThinkingLevelsForModel(item.entry.model).includes(
          thinkingLevel,
        )))
  )
    return;
  if (item.kind === "model" && item.key !== selectedKey) {
    onChange({
      model: {
        provider: item.entry.model.provider,
        modelId: item.entry.model.modelId,
      },
      thinkingLevel: thinkingDisabled
        ? (thinkingLevel ?? "off")
        : clampThinkingLevelForModel(thinkingLevel ?? "off", item.entry.model),
    });
  }
  if (close) onChoose?.();
}

function chooseLevel(model: ModelInfo, level: ThinkingLevel): void {
  if (thinkingDisabled) return;
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

<PopoverSearch>
  <SearchInput
    bind:value={query}
    bind:ref={searchRef}
    placeholder="Search models"
    ariaLabel="Search models"
    onkeydown={handleSearchKeydown}
    controls={listId}
    activeDescendant={navigation.activeDescendant}
  />
  {#if requiredCapabilities.length > 0}
    <p class="pt-1 text-xs text-muted-foreground">
      {requiredCapabilities
        .map((capability) => modelCapabilityLabels[capability])
        .join(" + ")} models only — required by this tool
    </p>
  {/if}
</PopoverSearch>

<PopoverBody>
  <Tooltip.Provider delayDuration={300} disableHoverableContent>
    {#if items.length === 0}
      <p class="px-1.5 text-muted-foreground">
        {catalog.length === 0 ? emptyMessage : "No models match."}
      </p>
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
          {#snippet row({ item })}
            {#if item.kind === "header"}
              <div
                role="presentation"
                class="px-1.5 pt-2 pb-1 text-xs font-medium text-muted-foreground"
              >
                {item.label}
              </div>
            {:else if item.kind === "inherit"}
              <ModelCatalogRow
                id={rowId(item)}
                label={inheritOption?.label ?? ""}
                title={inheritOption?.description}
                selected={inheriting}
                disabled={modelDisabled}
                active={navigation.activeDescendant === rowId(item)}
                onclick={() => choose(item)}
              />
            {:else if item.kind === "unavailable"}
              <ModelCatalogRow
                id={rowId(item)}
                label={`${item.selection.provider}/${item.selection.modelId}`}
                selected
                disabled
                active={navigation.activeDescendant === rowId(item)}
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
                title={`${entry.model.provider}/${entry.model.modelId}`}
                model={entry.model}
                {selected}
                disabled={modelDisabled ||
                  !isModelCompatible(entry.model) ||
                  (thinkingDisabled &&
                    thinkingLevel !== undefined &&
                    !supportedThinkingLevelsForModel(entry.model).includes(
                      thinkingLevel,
                    ))}
                active={navigation.activeDescendant === rowId(item)}
                onclick={() => choose(item)}
              ></ModelCatalogRow>
            {/if}
          {/snippet}
        </VirtualScroller>
      </div>
      {#if catalog.length === 0}
        <p class="px-1.5 pt-1 text-muted-foreground">{emptyMessage}</p>
      {/if}
    {/if}
  </Tooltip.Provider>
</PopoverBody>

{#if showReasoning && (reasoningLevels.length > 0 || onThinkingChange || unsupportedReasoning)}
  <section
    class="grid flex-none gap-1 border-t border-border px-2 pt-1.5 pb-2"
    aria-label="Reasoning level"
  >
    <span class="flex items-center gap-1 px-1.5 text-xs text-muted-foreground">
      Reasoning{reasoningModelLabel || inheriting
        ? ` · ${reasoningModelLabel || inheritOption?.label}`
        : ""}
      {#if thinkingDisabled}
        <Lock class="size-3" aria-label={lockTitle} />
      {/if}
    </span>
    <ToggleGroup.Root
      type="single"
      size="sm"
      spacing={1}
      variant="chip"
      value={thinkingLevel ?? "inherit"}
      disabled={thinkingDisabled}
      aria-label={`${label} reasoning level`}
      class="flex-wrap justify-start"
      onValueChange={(next) => {
        if (!next) return;
        if (next === "inherit") onThinkingChange?.(undefined);
        else if (reasoningModel)
          chooseLevel(reasoningModel, next as ThinkingLevel);
      }}
    >
      {#if onThinkingChange}
        <ToggleGroup.Item value="inherit" class="flex-none"
          >Use settings</ToggleGroup.Item
        >
      {/if}
      {#each reasoningLevels as level (level)}
        <ToggleGroup.Item
          value={level}
          title={THINKING_LEVEL_DETAILS[level]}
          class="flex-none capitalize">{level}</ToggleGroup.Item
        >
      {/each}
    </ToggleGroup.Root>
    {#if unsupportedReasoning}
      <p class="px-1.5 text-xs text-warning">
        Saved {thinkingLevel} reasoning is not supported by this model.{thinkingDisabled
          ? ` ${lockTitle}.`
          : " Choose a supported level or use settings."}
      </p>
    {/if}
    {#if inheriting && onThinkingChange}
      <p class="px-1.5 text-xs text-muted-foreground">
        Available levels depend on the model selected in settings.
      </p>
    {/if}
  </section>
{/if}
