<script lang="ts">
import type { Snippet } from "svelte";
import ArrowUpFromLine from "@lucide/svelte/icons/arrow-up-from-line";
import Braces from "@lucide/svelte/icons/braces";
import Brain from "@lucide/svelte/icons/brain";
import Image from "@lucide/svelte/icons/image";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import {
  formatTokenCapacity,
  supportsImageInput,
} from "$lib/presentation/utils/model";
import type { ModelCatalogEntry } from "$lib/presentation/utils/model-catalog";

type Props = {
  entry: ModelCatalogEntry;
  leading: Snippet;
};

let { entry, leading }: Props = $props();

const contextLabel = $derived(
  entry.model.contextWindow > 0
    ? `Context window: ${entry.model.contextWindow.toLocaleString()} tokens`
    : "Context window unknown",
);
const outputLabel = $derived(
  `Maximum output: ${entry.model.maxOutputTokens.toLocaleString()} tokens`,
);
</script>

{@render leading()}
<span class="grid min-w-0 flex-1 gap-0.5">
  <span class="truncate text-xs font-medium text-foreground">
    {entry.displayName}
  </span>
  <span class="truncate text-xs text-muted-foreground">
    {entry.providerLabel} ·
    <span class="font-mono">{entry.model.modelId}</span>
  </span>
</span>
<span
  class="flex flex-none items-center gap-1.5 text-xs text-muted-foreground tabular-nums"
>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <span
          {...props}
          class="inline-flex items-center gap-1 rounded-sm"
          aria-label={contextLabel}
        >
          <Braces class="size-3.5" aria-hidden="true" />
          <span>{formatTokenCapacity(entry.model.contextWindow)}</span>
        </span>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="top">{contextLabel}</Tooltip.Content>
  </Tooltip.Root>

  {#if entry.model.maxOutputTokens > 0}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <span
            {...props}
            class="inline-flex items-center gap-1 rounded-sm"
            aria-label={outputLabel}
          >
            <ArrowUpFromLine class="size-3.5" aria-hidden="true" />
            <span>{formatTokenCapacity(entry.model.maxOutputTokens)}</span>
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
            class="inline-flex rounded-sm"
            aria-label="Reasoning support"
          >
            <Brain class="size-3.5" aria-hidden="true" />
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
            class="inline-flex rounded-sm"
            aria-label="Image input support"
          >
            <Image class="size-3.5" aria-hidden="true" />
          </span>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="top">Accepts image input</Tooltip.Content>
    </Tooltip.Root>
  {/if}
</span>
