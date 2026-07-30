<script lang="ts">
import Search from "@lucide/svelte/icons/search";
import X from "@lucide/svelte/icons/x";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { cn } from "@nervekit/ui-kit/core/utils";

type Props = {
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
  count?: string;
  class?: string;
};

let {
  value = $bindable(""),
  placeholder = "Search",
  ariaLabel = "Search",
  count,
  class: className,
}: Props = $props();
</script>

<div class={cn("flex min-w-0 items-center gap-2", className)}>
  <div class="relative min-w-0 flex-1">
    <Search
      class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
      aria-hidden="true"
    />
    <Input
      bind:value
      size="sm"
      {placeholder}
      {ariaLabel}
      class="pr-7 pl-7"
      type="text"
    />
    {#if value}
      <Button
        variant="ghost"
        size="icon-sm"
        class="absolute top-1/2 right-0.5 size-6 -translate-y-1/2"
        ariaLabel="Clear search"
        onclick={() => (value = "")}
      >
        <X class="size-3.5" aria-hidden="true" />
      </Button>
    {/if}
  </div>
  {#if count}
    <span class="flex-none text-xs text-muted-foreground">{count}</span>
  {/if}
</div>
