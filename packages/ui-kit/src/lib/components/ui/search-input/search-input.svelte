<script lang="ts">
import type { Component, Snippet } from "svelte";
import Search from "@lucide/svelte/icons/search";
import X from "@lucide/svelte/icons/x";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { cn } from "@nervekit/ui-kit/core/utils";

type Props = {
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** Height. Search fields are dense by default. */
  size?: "xs" | "sm";
  /** Replaces the leading magnifier (e.g. a tag filter). */
  icon?: Component<{ class?: string; "aria-hidden"?: "true" }>;
  clearable?: boolean;
  disabled?: boolean;
  class?: string;
  inputClass?: string;
  ref?: HTMLInputElement | null;
  /** Rendered after the field, e.g. a result count. */
  trailing?: Snippet;
  onValueChange?: (value: string) => void;
};

let {
  value = $bindable(""),
  placeholder = "Search",
  ariaLabel = "Search",
  size = "xs",
  icon: Icon = Search,
  clearable = true,
  disabled = false,
  class: className,
  inputClass,
  ref = $bindable(null),
  trailing,
  onValueChange,
}: Props = $props();

function setValue(next: string): void {
  value = next;
  onValueChange?.(next);
}
</script>

<div class={cn("flex min-w-0 items-center gap-2", className)}>
  <div class="relative min-w-0 flex-1">
    <Icon
      class={cn(
        "pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground",
        disabled && "opacity-50",
      )}
      aria-hidden="true"
    />
    <Input
      bind:ref
      bind:value
      {size}
      {placeholder}
      {ariaLabel}
      {disabled}
      type="text"
      class={cn("pl-7", clearable && value ? "pr-7" : undefined, inputClass)}
      oninput={(event) =>
        onValueChange?.((event.currentTarget as HTMLInputElement).value)}
    />
    {#if clearable && value}
      <Button
        variant="ghost"
        size="icon-xs"
        class="absolute top-1/2 right-0.5 -translate-y-1/2"
        ariaLabel={`Clear ${ariaLabel.toLowerCase()}`}
        {disabled}
        onclick={() => setValue("")}
      >
        <X class="size-3.5" aria-hidden="true" />
      </Button>
    {/if}
  </div>
  {#if trailing}
    {@render trailing()}
  {/if}
</div>
