<!--
  Single-model picker for settings. A field-like trigger opens an anchored
  popover with grouped model search and a virtual list.
  Choosing a row applies immediately and keeps the popover open so the inline
  reasoning level can follow; Enter chooses the highlighted row and closes.
-->
<script lang="ts">
import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
import Lock from "@lucide/svelte/icons/lock";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type {
  ModelInfo,
  ModelSelection,
  ThinkingLevel,
} from "@nervekit/contracts/models";
import Popover, {
  PopoverHeader,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { cn } from "@nervekit/ui-kit/utils";
import { supportedThinkingLevelsForModel } from "$lib/presentation/state/thinking-levels";
import {
  buildModelCatalog,
  filterModelCatalog,
  modelSupportsReasoning,
  type ModelCapability,
} from "$lib/presentation/utils/model-catalog";
import ModelPickerPanel from "./ModelPickerPanel.svelte";
import { resolvePickerValue } from "./model-picker";

type Props = {
  /** Accessible name of the setting, e.g. "Image explanation model". */
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
  class?: string;
  tourId?: string;
  emptyMessage?: string;
  disabled?: boolean;
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
  label,
  models,
  value,
  thinkingLevel,
  onChange,
  requiredCapabilities = [],
  showReasoning = true,
  class: className,
  tourId,
  emptyMessage = "Authenticate a provider before choosing a model.",
  disabled = false,
  modelDisabled = false,
  thinkingDisabled = false,
  lockReason,
  inheritOption,
  inherit = false,
  onInherit,
  onThinkingChange,
  isModelCompatible = () => true,
}: Props = $props();

let open = $state(false);

const catalog = $derived(
  filterModelCatalog(
    buildModelCatalog(models),
    "",
    "all",
    new Set(requiredCapabilities),
  ),
);
/** Only a fully locked picker stops opening; a half lock keeps the other half editable. */
const fullyLocked = $derived(disabled || (modelDisabled && thinkingDisabled));
const inheriting = $derived(Boolean(inheritOption) && inherit);
const resolved = $derived(
  resolvePickerValue(catalog, inheriting ? undefined : value),
);
const selectedModel = $derived(
  resolved.kind === "available" ? resolved.entry.model : undefined,
);
const unsupportedReasoning = $derived(
  showReasoning &&
    !inheriting &&
    selectedModel !== undefined &&
    thinkingLevel !== undefined &&
    !supportedThinkingLevelsForModel(selectedModel).includes(thinkingLevel),
);
const showLevel = $derived(
  showReasoning &&
    (inheriting ||
      (selectedModel !== undefined && modelSupportsReasoning(selectedModel))) &&
    thinkingLevel !== undefined &&
    thinkingLevel !== "off" &&
    !unsupportedReasoning,
);

const lockTitle = $derived(
  lockReason ??
    (modelDisabled && thinkingDisabled
      ? "Locked"
      : modelDisabled
        ? "Model is locked"
        : "Reasoning level is locked"),
);
const baseTriggerTitle = $derived(
  inheriting && inheritOption
    ? `${label}: ${inheritOption.label}`
    : resolved.kind === "available"
      ? `${label}: ${resolved.entry.displayName} · ${resolved.entry.providerLabel}${showLevel ? ` · ${thinkingLevel} reasoning` : ""}`
      : resolved.kind === "unavailable"
        ? `${label}: ${resolved.selection.provider}/${resolved.selection.modelId} is unavailable`
        : label,
);
const triggerTitle = $derived(
  modelDisabled || thinkingDisabled
    ? `${baseTriggerTitle} · ${lockTitle}`
    : baseTriggerTitle,
);

$effect(() => {
  if (fullyLocked) open = false;
});

function handleOpenChange(next: boolean): void {
  open = fullyLocked ? false : next;
}
</script>

<Popover
  {open}
  onOpenChange={handleOpenChange}
  size="lg"
  variant="field"
  align="start"
  ariaLabel={label}
  {triggerTitle}
  triggerClass={cn(
    "flex min-w-0 justify-start gap-1.5 rounded-md border border-input bg-input-background pr-1.5 pl-2 text-left text-sm shadow-xs transition-colors hover:bg-hover ",
    "h-control",
    fullyLocked && "pointer-events-none opacity-50",
    className,
  )}
>
  {#snippet trigger()}
    <span
      class="flex min-w-0 flex-1 items-baseline gap-1.5"
      data-tour-id={tourId}
    >
      {#if modelDisabled}
        <Lock
          class="size-3 flex-none self-center text-muted-foreground"
          aria-label={lockTitle}
        />
      {/if}
      {#if inheriting && inheritOption}
        <span class="truncate text-foreground">{inheritOption.label}</span>
      {:else if resolved.kind === "available"}
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
    {#if thinkingDisabled}
      <Lock
        class="size-3 flex-none text-muted-foreground"
        aria-label={lockTitle}
      />
    {/if}
    {#if showLevel}
      <Badge
        variant="accent"
        class={cn("capitalize", thinkingDisabled && "opacity-60")}
        >{thinkingLevel}</Badge
      >
    {/if}
    <ChevronsUpDown
      class="size-3.5 flex-none text-muted-foreground"
      aria-hidden="true"
    />
  {/snippet}

  <PopoverHeader title={label} />
  <ModelPickerPanel
    {label}
    {models}
    {value}
    {thinkingLevel}
    {onChange}
    {requiredCapabilities}
    {showReasoning}
    {emptyMessage}
    {modelDisabled}
    {thinkingDisabled}
    {lockReason}
    {inheritOption}
    {inherit}
    {onInherit}
    {onThinkingChange}
    {isModelCompatible}
    onChoose={() => {
      open = false;
    }}
  />
</Popover>
