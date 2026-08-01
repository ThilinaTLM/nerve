<script lang="ts">
import type { Snippet } from "svelte";
import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
import Info from "@lucide/svelte/icons/info";
import type { ModelInfo, ModelSelection, ThinkingLevel } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { SettingsRow } from "$lib/presentation/components/settings";
import SingleModelSelectionDialog from "../../shared/SingleModelSelectionDialog.svelte";

type SaveSelection = {
  model?: ModelSelection;
  thinkingLevel: ThinkingLevel;
};

type Props = {
  label: string;
  description?: string;
  models: ModelInfo[];
  selectedModel?: ModelSelection;
  selectedThinkingLevel: ThinkingLevel;
  summaryTitle: string;
  summaryMeta: Snippet;
  fallbackOption: { label: string; detail: string; actionLabel: string };
  fallbackThinkingLevels: ThinkingLevel[];
  dialogTitle: string;
  dialogDescription?: string;
  confirmLabel: string;
  policyLabel?: string;
  policy?: Snippet;
  onSave: (selection: SaveSelection) => void;
};

let {
  label,
  description,
  models,
  selectedModel,
  selectedThinkingLevel,
  summaryTitle,
  summaryMeta,
  fallbackOption,
  fallbackThinkingLevels,
  dialogTitle,
  dialogDescription,
  confirmLabel,
  policyLabel = "Agent policy",
  policy,
  onSave,
}: Props = $props();

let dialogOpen = $state(false);
</script>

<SettingsRow {label} {description} layout="stacked">
  <div class="flex items-center gap-1.5">
    <!-- Select-like trigger styled to match the choice cards above it. -->
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={`${label}: ${summaryTitle}. Change model`}
      class="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded-sm border border-border/50 px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
      onclick={() => (dialogOpen = true)}
    >
      <span class="grid min-w-0 gap-0.5">
        <span class="truncate text-sm font-medium text-foreground"
          >{summaryTitle}</span
        >
        <span class="truncate text-xs text-muted-foreground">
          {@render summaryMeta()}
        </span>
      </span>
      <ChevronsUpDown
        class="size-3.5 flex-none text-muted-foreground"
        aria-hidden="true"
      />
    </button>
    {#if policy}
      <Tooltip.Provider delayDuration={200}>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="icon-xs"
                ariaLabel={policyLabel}
              >
                <Info class="size-3.5" aria-hidden="true" />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content side="top" class="max-w-xs p-0">
            <div class="grid divide-y divide-border/40">
              {@render policy()}
            </div>
          </Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
    {/if}
  </div>
</SettingsRow>

<SingleModelSelectionDialog
  bind:open={dialogOpen}
  title={dialogTitle}
  description={dialogDescription}
  {models}
  {selectedModel}
  {selectedThinkingLevel}
  {fallbackOption}
  {fallbackThinkingLevels}
  {confirmLabel}
  {onSave}
/>
