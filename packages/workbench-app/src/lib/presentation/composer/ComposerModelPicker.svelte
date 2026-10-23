<script lang="ts">
import type { ModelInfo, ThinkingLevel } from "@nervekit/contracts/models";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverRow,
  PopoverSection,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { VirtualScroller } from "@nervekit/ui-kit/components/composites/virtual-list";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import {
  clampThinkingLevelForModel,
  supportedThinkingLevelsForModel,
} from "$lib/presentation/state/thinking-levels";
import {
  contextualModelLabel,
  modelKey,
  parseModelKey,
} from "$lib/presentation/utils/model";
import type { ComposerModelChange } from "../conversations/conversation-view-contracts.js";

type Props = {
  /** Scoped, usable models. */
  models?: ModelInfo[];
  selectedModelKey?: string;
  thinkingLevel?: ThinkingLevel;
  disabled?: boolean;
  /** The active agent profile locks the model. */
  modelLocked?: boolean;
  /** The active agent profile locks the reasoning level. */
  thinkingLocked?: boolean;
  lockReason?: string;
  emptyMessage?: string;
  onChange?: (next: ComposerModelChange) => void;
};

let {
  models = [],
  selectedModelKey = "",
  thinkingLevel = "off",
  disabled = false,
  modelLocked = false,
  thinkingLocked = false,
  lockReason,
  emptyMessage = "No models available. Configure a provider or adjust Scoped Models in Settings.",
  onChange,
}: Props = $props();

let open = $state(false);

const selectedModel = $derived(
  models.find((model) => modelKey(model) === selectedModelKey),
);
const thinkingLevels = $derived(supportedThinkingLevelsForModel(selectedModel));
const hasThinking = $derived(thinkingLevels.length > 1);

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
    default:
      return "Off";
  }
}

const triggerLabel = $derived(
  selectedModel
    ? contextualModelLabel(selectedModel, models)
    : parseModelKey(selectedModelKey)
      ? `${selectedModelKey} (unavailable)`
      : "Select model",
);
const showSuffix = $derived(hasThinking && thinkingLevel !== "off");
const triggerTitle = $derived(
  `${showSuffix ? `${triggerLabel} (${thinkingLevelLabel(thinkingLevel)})` : triggerLabel}${lockReason ? ` · ${lockReason}` : ""}`,
);

function selectModel(model: ModelInfo) {
  if (
    disabled ||
    modelLocked ||
    (thinkingLocked &&
      !supportedThinkingLevelsForModel(model).includes(thinkingLevel))
  )
    return;
  const key = modelKey(model);
  if (key === selectedModelKey) return;
  onChange?.({
    model: { provider: model.provider, modelId: model.modelId },
    // The host clamps the level to what the new model supports.
    thinkingLevel: thinkingLocked
      ? thinkingLevel
      : clampThinkingLevelForModel(thinkingLevel, model),
  });
}

function selectThinking(level: ThinkingLevel) {
  if (disabled || thinkingLocked || level === thinkingLevel) return;
  if (!selectedModel) return;
  onChange?.({
    model: { provider: selectedModel.provider, modelId: selectedModel.modelId },
    thinkingLevel: level,
  });
}

$effect(() => {
  if (disabled) open = false;
});
</script>

<Popover
  bind:open
  size="md"
  triggerClass="composer-tab flex-initial overflow-hidden"
  ariaLabel="Model and thinking level"
  {triggerTitle}
  side="top"
  align="start"
>
  {#snippet trigger()}
    <span
      class="inline-flex min-w-0 max-w-full items-center gap-1.5 text-inherit"
      class:opacity-60={disabled}
      aria-disabled={disabled}
      data-tour-id="composer-model"
    >
      <span class="min-w-0 truncate">{triggerLabel}</span>
      {#if showSuffix}<span
          class="flex-none text-muted-foreground @max-[560px]/composer-toolbar:hidden"
          >({thinkingLevelShortLabel(thinkingLevel)})</span
        >{/if}
    </span>
  {/snippet}

  <PopoverHeader title="Model" meta={`${models.length}`} />

  <PopoverBody>
    {#if lockReason}
      <p class="px-1.5 text-muted-foreground">{lockReason}</p>
    {/if}
    {#if models.length === 0}
      <p class="px-1.5 text-muted-foreground">{emptyMessage}</p>
    {:else}
      <VirtualScroller
        items={models}
        getKey={(model) => modelKey(model)}
        estimateSize={() => 28}
        gap={2}
        viewportClass="max-h-[min(44vh,18rem)]"
        viewportAriaLabel="Available models"
      >
        {#snippet row({ item: model })}
          <PopoverRow
            label={contextualModelLabel(model, models)}
            selected={modelKey(model) === selectedModelKey}
            disabled={disabled ||
              modelLocked ||
              (thinkingLocked &&
                !supportedThinkingLevelsForModel(model).includes(
                  thinkingLevel,
                ))}
            onclick={() => selectModel(model)}
          />
        {/snippet}
      </VirtualScroller>
    {/if}

    {#if hasThinking}
      <PopoverSection label="Reasoning effort" separated>
        <ToggleGroup.Root
          type="single"
          size="sm"
          spacing={1}
          variant="chip"
          value={thinkingLevel}
          aria-label="Thinking level"
          class="flex-wrap justify-start px-1.5"
          onValueChange={(value) => {
            if (value) selectThinking(value as ThinkingLevel);
          }}
        >
          {#each thinkingLevels as level (level)}
            <ToggleGroup.Item
              value={level}
              class="flex-none"
              title={thinkingLevelDetails[level]}
              disabled={disabled || thinkingLocked}
            >
              {thinkingLevelLabel(level)}
            </ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>
      </PopoverSection>
    {/if}
  </PopoverBody>
</Popover>
