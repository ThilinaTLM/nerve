<script lang="ts">
import type { Snippet } from "svelte";
import Info from "@lucide/svelte/icons/info";
import MousePointerClick from "@lucide/svelte/icons/mouse-pointer-click";
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
  policyLabel?: string;
  policy?: Snippet;
  tourId?: string;
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
  policyLabel = "Agent policy",
  policy,
  tourId,
  onSave,
}: Props = $props();

let dialogOpen = $state(false);
</script>

<SettingsRow {label} {description} layout="responsive">
  {#snippet control()}
    <div
      class="relative w-full min-w-0 cursor-pointer rounded-md border border-transparent bg-accent/90 transition-colors hover:bg-accent/95 dark:bg-accent/60 dark:hover:bg-accent/70 sm:w-64"
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${label}: ${summaryTitle}. Change model`}
        data-tour-id={tourId}
        class="absolute inset-0 cursor-pointer rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onclick={() => (dialogOpen = true)}
      ></button>
      <div
        class="pointer-events-none relative flex min-w-0 items-center gap-2 px-2.5 py-1.5"
      >
        <div class="grid min-w-0 flex-1 gap-0.5">
          <div class="flex min-w-0 items-center gap-1">
            <span class="truncate text-sm font-medium text-foreground"
              >{summaryTitle}</span
            >
            {#if policy}
              <Tooltip.Provider delayDuration={200}>
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="ghost"
                        size="icon-xs"
                        class="pointer-events-auto -my-1 flex-none cursor-pointer text-primary hover:bg-primary/10"
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
          <span class="truncate text-xs text-muted-foreground">
            {@render summaryMeta()}
          </span>
        </div>
        <MousePointerClick
          class="size-3.5 flex-none text-primary"
          aria-hidden="true"
        />
      </div>
    </div>
  {/snippet}
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
  {onSave}
/>
