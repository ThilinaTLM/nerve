<!--
  One model in a settings catalog. `option` rows live in the ModelPicker
  listbox (keyboard highlight is driven by its search field); `checkbox` rows
  live in the inline scope editor. Capability cells keep fixed widths so the
  context size, image and reasoning columns align across rows. Option rows
  mark the selection in a leading slot so the row ends at its capabilities.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import Brain from "@lucide/svelte/icons/brain";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import Image from "@lucide/svelte/icons/image";
import type { ModelInfo } from "$lib/api";
import { Checkbox } from "@nervekit/ui-kit/components/ui/checkbox";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { cn } from "@nervekit/ui-kit/utils";
import {
  formatTokenCapacity,
  supportsImageInput,
} from "$lib/presentation/utils/model";
import { modelSupportsReasoning } from "$lib/presentation/utils/model-catalog";

type Props = {
  label: string;
  detail?: string;
  /** Native tooltip, e.g. the raw provider/model id. */
  title?: string;
  /** Shows capability cells when present. */
  model?: ModelInfo;
  mode?: "option" | "checkbox";
  selected?: boolean;
  /** Keyboard highlight in the picker listbox. Distinct from `selected`. */
  active?: boolean;
  disabled?: boolean;
  id?: string;
  class?: string;
  onclick?: () => void;
  leading?: Snippet;
  /** Inline after the label and detail, e.g. a small badge. */
  badge?: Snippet;
  trailing?: Snippet;
};

let {
  label,
  detail,
  title,
  model,
  mode = "option",
  selected = false,
  active = false,
  disabled = false,
  id,
  class: className,
  onclick,
  leading,
  badge,
  trailing,
}: Props = $props();

const contextLabel = $derived(
  model && model.contextWindow > 0
    ? `Context window: ${model.contextWindow.toLocaleString()} tokens${model.maxOutputTokens > 0 ? ` · max output ${model.maxOutputTokens.toLocaleString()}` : ""}`
    : "Context window unknown",
);
const vision = $derived(model ? supportsImageInput(model) : false);
const reasoning = $derived(model ? modelSupportsReasoning(model) : false);
</script>

{#snippet text()}
  <span class="flex min-w-0 flex-1 items-baseline gap-1.5">
    <span
      class={cn(
        "max-w-full shrink-0 truncate text-sm text-foreground",
        selected && mode === "option" && "font-medium",
      )}>{label}</span
    >
    {#if detail}
      <span class="min-w-0 truncate text-xs text-muted-foreground"
        >{detail}</span
      >
    {/if}
    {#if badge}
      <span class="flex flex-none self-center">{@render badge()}</span>
    {/if}
  </span>
{/snippet}

{#snippet capabilities()}
  {#if model}
    <span class="flex flex-none items-center gap-2 text-muted-foreground">
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <span
              {...props}
              class="w-12 text-right text-xs tabular-nums"
              aria-label={contextLabel}
              >{formatTokenCapacity(model.contextWindow)}</span
            >
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">{contextLabel}</Tooltip.Content>
      </Tooltip.Root>
      <span
        class={cn("inline-flex text-info", !vision && "invisible")}
        title="Accepts image input"
        aria-label={vision ? "Accepts image input" : undefined}
      >
        <Image class="size-3.5" aria-hidden="true" />
      </span>
      <span
        class={cn("inline-flex text-primary", !reasoning && "invisible")}
        title={`Reasoning: ${model.supportedThinkingLevels.join(", ")}`}
        aria-label={reasoning ? "Supports reasoning" : undefined}
      >
        <Brain class="size-3.5" aria-hidden="true" />
      </span>
    </span>
  {/if}
{/snippet}

{#if mode === "option"}
  <div
    {id}
    {title}
    role="option"
    tabindex="-1"
    aria-selected={selected}
    aria-disabled={disabled || undefined}
    class={cn(
      "cursor-pointer rounded-md transition-colors hover:bg-accent",
      selected && "bg-selected hover:bg-selected",
      active && "outline outline-1 -outline-offset-1 outline-ring/55",
      disabled && "cursor-default opacity-70 hover:bg-transparent",
      className,
    )}
    onclick={() => {
      if (!disabled) onclick?.();
    }}
    onkeydown={(event) => {
      if (!disabled && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        onclick?.();
      }
    }}
  >
    <div class="flex min-h-7 min-w-0 items-center gap-2 py-1 pr-1.5 pl-1">
      <CircleCheck
        class={cn(
          "size-3.5 flex-none text-foreground",
          !selected && "invisible",
        )}
        aria-hidden="true"
      />
      {@render leading?.()}
      {@render text()}
      {@render capabilities()}
      {@render trailing?.()}
    </div>
  </div>
{:else}
  <div
    {title}
    class={cn(
      "flex h-8 min-w-0 items-center gap-2 border-b border-border/50 pr-2 pl-3 transition-colors hover:bg-accent/50",
      disabled && "opacity-70",
      className,
    )}
  >
    <Label
      class="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2.5"
    >
      <Checkbox
        checked={selected}
        {disabled}
        size="sm"
        aria-label={`Include ${label}`}
        onCheckedChange={(next) => {
          if (next !== selected) onclick?.();
        }}
      />
      {@render leading?.()}
      {@render text()}
    </Label>
    {@render capabilities()}
    {#if trailing}
      <span class="flex min-w-7 flex-none items-center justify-end gap-1">
        {@render trailing()}
      </span>
    {/if}
  </div>
{/if}
