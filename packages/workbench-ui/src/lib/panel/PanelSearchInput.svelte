<script lang="ts">
import Search from "@lucide/svelte/icons/search";
import X from "@lucide/svelte/icons/x";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  value = $bindable(""),
  ref = $bindable<HTMLInputElement | null>(null),
  placeholder = "Filter…",
  ariaLabel = placeholder,
  title,
  ariaKeyshortcuts,
  class: className,
  onclear,
  oninput,
}: {
  value?: string;
  ref?: HTMLInputElement | null;
  placeholder?: string;
  ariaLabel?: string;
  title?: string;
  ariaKeyshortcuts?: string;
  class?: string;
  onclear?: () => void;
  oninput?: (value: string) => void;
} = $props();

function clear() {
  value = "";
  onclear?.();
  oninput?.("");
}
</script>

<div class={cn("relative flex min-w-0 flex-1 items-center", className)}>
  <Search
    class="pointer-events-none absolute left-2 size-3 text-muted-foreground"
    aria-hidden="true"
  />
  <Input
    size="xs"
    bind:value
    bind:ref
    {placeholder}
    {ariaLabel}
    {title}
    aria-keyshortcuts={ariaKeyshortcuts}
    class="pr-7 pl-6"
    oninput={(event) => oninput?.(event.currentTarget.value)}
  />
  {#if value}
    <Button
      variant="ghost"
      size="icon-xs"
      class="absolute right-0.5"
      ariaLabel="Clear filter"
      onclick={clear}
    >
      <X aria-hidden="true" />
    </Button>
  {/if}
</div>
