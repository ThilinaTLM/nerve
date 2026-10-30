<script lang="ts">
import type { ModelInfo, ThinkingLevel } from "@nervekit/contracts/models";
import Popover, {
  PopoverHeader,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { ModelPickerPanel } from "$lib/presentation/model-picker";
import {
  supportedThinkingLevelsForModel,
  thinkingLevelShortLabel,
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

function thinkingLevelLabel(level: ThinkingLevel): string {
  return level === "off" ? "Off" : level[0].toUpperCase() + level.slice(1);
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

$effect(() => {
  if (disabled) open = false;
});
</script>

<Popover
  triggerWidthKey={selectedModel
    ? `${triggerLabel}:${showSuffix ? thinkingLevelShortLabel(thinkingLevel) : ""}`
    : null}
  bind:open
  size="md"
  triggerClass="composer-tab flex-initial overflow-hidden"
  ariaLabel="Model and thinking level"
  {triggerTitle}
  side="top"
  presentation="adaptive"
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
          class="flex-none text-muted-foreground @max-[300px]/composer-toolbar:hidden @min-[481px]/composer-toolbar:@max-[560px]/composer-toolbar:hidden"
          >({thinkingLevelShortLabel(thinkingLevel)})</span
        >{/if}
    </span>
  {/snippet}

  <PopoverHeader title="Model" meta={`${models.length}`} />

  <ModelPickerPanel
    label="Conversation model"
    {models}
    value={parseModelKey(selectedModelKey) ?? undefined}
    {thinkingLevel}
    modelDisabled={disabled || modelLocked}
    thinkingDisabled={disabled || thinkingLocked}
    {lockReason}
    {emptyMessage}
    onChange={(next) => {
      if (next.model)
        onChange?.({ model: next.model, thinkingLevel: next.thinkingLevel });
    }}
    onChoose={() => {
      open = false;
    }}
  />
</Popover>
