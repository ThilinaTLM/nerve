<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import type { AgentRecord, ModelInfo, PlanReviewResolveOptions } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import DialogShell from "$lib/components/ui/dialog-shell";
  import {
    contextualModelLabel,
    modelKey,
    parseModelKey,
  } from "$lib/core/utils/model";
  import {
    clampThinkingLevelForModel,
    supportedThinkingLevelsForModel,
  } from "$lib/features/conversations/state/agent-selection-defaults";

  type ThinkingLevel = AgentRecord["thinkingLevel"];

  type Props = {
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
  }: Props = $props();

  let selectedModelKey = $state("");
  let selectedThinkingLevel = $state<ThinkingLevel>("off");
  let confirming = $state(false);

  const selectedModel = $derived(
    models.find((model) => modelKey(model) === selectedModelKey),
  );
  const thinkingLevels = $derived(supportedThinkingLevelsForModel(selectedModel));
  const confirmDisabled = $derived(!selectedModel || confirming);

  const thinkingLevelDetails: Record<ThinkingLevel, string> = {
    off: "No reasoning",
    minimal: "Very brief reasoning",
    low: "Light reasoning",
    medium: "Moderate reasoning",
    high: "Deep reasoning",
    xhigh: "Maximum reasoning",
  };

  function thinkingLevelLabel(level: ThinkingLevel): string {
    return level === "off" ? "Off" : level[0].toUpperCase() + level.slice(1);
  }

  function resetSelection() {
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
    selectedModelKey = modelKey(model);
    selectedThinkingLevel = clampThinkingLevelForModel(
      selectedThinkingLevel,
      model,
    );
  }

  function selectThinking(level: ThinkingLevel) {
    selectedThinkingLevel = clampThinkingLevelForModel(level, selectedModel);
  }

  async function confirmSelection() {
    if (!selectedModel || confirming) return;
    const implementationModel = parseModelKey(selectedModelKey);
    if (!implementationModel) return;
    confirming = true;
    try {
      await onConfirm?.({
        implementationModel,
        implementationThinkingLevel: selectedThinkingLevel,
      });
      handleOpenChange(false);
    } finally {
      confirming = false;
    }
  }

  $effect(() => {
    if (!open) return;
    resetSelection();
  });
</script>

<DialogShell {open} {title} {description} onOpenChange={handleOpenChange} class="max-w-xl">
  <div class="grid gap-4 px-3.5 py-4">
    <section class="grid gap-2">
      <p class="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model</p>
      {#if models.length === 0}
        <p class="m-0 rounded-md border border-dashed border-border bg-muted p-3 text-sm text-muted-foreground">
          No models available. Configure a provider or adjust Scoped Models in Settings.
        </p>
      {:else}
        <div class="grid gap-1" role="listbox" aria-label="Implementation model">
          {#each models as model (modelKey(model))}
            {@const key = modelKey(model)}
            {@const active = key === selectedModelKey}
            <button
              type="button"
              class={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-transparent text-foreground hover:bg-accent"
              }`}
              aria-selected={active}
              role="option"
              onclick={() => selectModel(model)}
            >
              <span class="min-w-0 truncate font-medium">{contextualModelLabel(model, models)}</span>
              {#if active}<Check class="size-4" strokeWidth={2.4} />{/if}
            </button>
          {/each}
        </div>
      {/if}
    </section>

    {#if selectedModel}
      <section class="grid gap-2 border-t border-border pt-4">
        <p class="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Thinking level</p>
        <div class="flex flex-wrap gap-2" role="group" aria-label="Implementation thinking level">
          {#each thinkingLevels as level (level)}
            {@const active = level === selectedThinkingLevel}
            <button
              type="button"
              class={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-input text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
              aria-pressed={active}
              title={thinkingLevelDetails[level]}
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
    <Button variant="secondary" onclick={() => handleOpenChange(false)} disabled={confirming}>Cancel</Button>
    <Button onclick={confirmSelection} disabled={confirmDisabled}>{confirmLabel}</Button>
  {/snippet}
</DialogShell>
