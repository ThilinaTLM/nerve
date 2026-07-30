<script lang="ts">
import type { Snippet } from "svelte";
import Info from "@lucide/svelte/icons/info";
import type { ModelInfo, ModelSelection, ThinkingLevel } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import {
  SettingsRow,
  SettingsSummaryRow,
} from "$lib/presentation/components/settings";
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
  fallbackOption: { label: string; detail: string };
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
  <SettingsSummaryRow title={summaryTitle} meta={summaryMeta}>
    {#snippet actions()}
      {#if policy}
        <Tooltip.Provider delayDuration={200}>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="ghost"
                  size="icon-sm"
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
      <Button size="sm" variant="outline" onclick={() => (dialogOpen = true)}
        >Change model</Button
      >
    {/snippet}
  </SettingsSummaryRow>
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
