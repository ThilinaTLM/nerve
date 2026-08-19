<script lang="ts">
import ArrowUpFromLine from "@lucide/svelte/icons/arrow-up-from-line";
import Braces from "@lucide/svelte/icons/braces";
import Brain from "@lucide/svelte/icons/brain";
import Image from "@lucide/svelte/icons/image";
import { Checkbox } from "@nervekit/ui-kit/components/ui/checkbox";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import * as RadioGroup from "@nervekit/ui-kit/components/ui/radio-group";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { cn } from "@nervekit/ui-kit/core/utils";
import { supportsImageInput } from "$lib/presentation/utils/model";
import type { ModelCatalogEntry } from "$lib/presentation/utils/model-catalog";

type Props = {
  entry: ModelCatalogEntry;
  selected?: boolean;
  disabled?: boolean;
  selectionMode?: "single" | "multiple";
  onclick?: () => void;
};

let {
  entry,
  selected = false,
  disabled = false,
  selectionMode = "single",
  onclick,
}: Props = $props();

const contextLabel = $derived(
  entry.model.contextWindow > 0
    ? `Context window: ${entry.model.contextWindow.toLocaleString()} tokens`
    : "Context window unknown",
);
const outputLabel = $derived(
  `Maximum output: ${entry.model.maxOutputTokens.toLocaleString()} tokens`,
);
</script>

<Label
  title={entry.model.modelId}
  class={cn(
    "flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md border bg-accent/90 px-2 py-2 text-left transition-colors hover:bg-accent/95 dark:bg-accent/60 dark:hover:bg-accent/70",
    selected ? "border-primary" : "border-transparent",
    disabled && "pointer-events-none opacity-55",
  )}
>
  {#if selectionMode === "multiple"}
    <Checkbox
      checked={selected}
      {disabled}
      size="sm"
      aria-label={`Select ${entry.displayName}`}
      onCheckedChange={(next) => {
        if (next !== selected) onclick?.();
      }}
    />
  {:else}
    <RadioGroup.Item
      value={entry.key}
      {disabled}
      size="sm"
      aria-label={entry.displayName}
    />
  {/if}
  <span class="grid min-w-0 flex-1 gap-0.5">
    <span class="truncate text-xs font-medium text-foreground"
      >{entry.displayName}</span
    >
    <span class="truncate text-xs text-muted-foreground"
      >{entry.providerLabel}</span
    >
  </span>
  <span
    class="flex flex-none items-center gap-1.5 text-muted-foreground"
    aria-hidden="true"
  >
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <span {...props} class="inline-flex" aria-label={contextLabel}>
            <Braces class="size-3.5" />
          </span>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="top">{contextLabel}</Tooltip.Content>
    </Tooltip.Root>

    {#if entry.model.maxOutputTokens > 0}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <span {...props} class="inline-flex" aria-label={outputLabel}>
              <ArrowUpFromLine class="size-3.5" />
            </span>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">{outputLabel}</Tooltip.Content>
      </Tooltip.Root>
    {/if}

    {#if entry.model.reasoning}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <span {...props} class="inline-flex" aria-label="Reasoning support">
              <Brain class="size-3.5" />
            </span>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Supports reasoning</Tooltip.Content>
      </Tooltip.Root>
    {/if}

    {#if supportsImageInput(entry.model)}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <span
              {...props}
              class="inline-flex"
              aria-label="Image input support"
            >
              <Image class="size-3.5" />
            </span>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Accepts image input</Tooltip.Content>
      </Tooltip.Root>
    {/if}
  </span>
</Label>
