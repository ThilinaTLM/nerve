<script lang="ts">
import ArrowUpFromLine from "@lucide/svelte/icons/arrow-up-from-line";
import Braces from "@lucide/svelte/icons/braces";
import Brain from "@lucide/svelte/icons/brain";
import Image from "@lucide/svelte/icons/image";
import { SelectRow } from "@nervekit/ui-kit/components/ui/select-row";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { supportsImageInput } from "$lib/presentation/utils/model";
import type { ModelCatalogEntry } from "$lib/presentation/utils/model-catalog";

type Props = {
  entry: ModelCatalogEntry;
  selected?: boolean;
  disabled?: boolean;
  onclick?: () => void;
};

let { entry, selected = false, disabled = false, onclick }: Props = $props();

const contextLabel = $derived(
  entry.model.contextWindow > 0
    ? `Context window: ${entry.model.contextWindow.toLocaleString()} tokens`
    : "Context window unknown",
);
const outputLabel = $derived(
  `Maximum output: ${entry.model.maxOutputTokens.toLocaleString()} tokens`,
);
</script>

<SelectRow
  {selected}
  {disabled}
  {onclick}
  title={entry.model.modelId}
  class="py-1.5"
>
  {#snippet label()}
    <span class="truncate text-xs font-medium text-foreground"
      >{entry.displayName}</span
    >
  {/snippet}
  {#snippet detail()}
    <span class="truncate text-xs text-muted-foreground"
      >{entry.providerLabel}</span
    >
  {/snippet}
  {#snippet trailing()}
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
              <span
                {...props}
                class="inline-flex"
                aria-label="Reasoning support"
              >
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
  {/snippet}
</SelectRow>
