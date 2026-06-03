<script lang="ts">
  import type { Snippet } from "svelte";
  import { Toggle } from "bits-ui";
  import { cn } from "../../utils/cn";

  type Props = {
    children?: Snippet;
    pressed?: boolean;
    disabled?: boolean;
    ariaLabel?: string;
    title?: string;
    class?: string;
    onPressedChange?: (pressed: boolean) => void;
  };

  let {
    children,
    pressed = $bindable(false),
    disabled = false,
    ariaLabel,
    title,
    class: className = "",
    onPressedChange,
  }: Props = $props();
</script>

<Toggle.Root
  bind:pressed
  {disabled}
  {title}
  aria-label={ariaLabel}
  {onPressedChange}
  class={cn(
    "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
    className,
  )}
>
  {@render children?.()}
</Toggle.Root>
