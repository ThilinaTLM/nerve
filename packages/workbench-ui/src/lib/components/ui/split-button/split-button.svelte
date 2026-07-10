<script lang="ts">
  import type { Snippet } from "svelte";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { Button, buttonVariants, type ButtonVariant, type ButtonSize } from "@nervekit/workbench-ui/components/ui/button";
  import * as DropdownMenu from "@nervekit/workbench-ui/components/ui/dropdown-menu";
  import { cn } from "@nervekit/workbench-ui/core/utils";

  type Props = {
    variant?: ButtonVariant;
    size?: ButtonSize;
    disabled?: boolean;
    menuAlign?: "start" | "end";
    menuClass?: string;
    triggerLabel?: string;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
    menu: Snippet;
  };

  let {
    variant = "default",
    size = "sm",
    disabled = false,
    menuAlign = "end",
    menuClass,
    triggerLabel,
    onclick,
    children,
    menu,
  }: Props = $props();

  const dividerClass = $derived(
    variant === "default" || variant === "success"
      ? "border-l-primary-foreground/25"
      : "border-l-border/70",
  );
</script>

<div class="inline-flex" role="group">
  <Button {variant} {size} {disabled} {onclick} class="rounded-r-none">
    {@render children()}
  </Button>
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class={cn(
        buttonVariants({ variant, size }),
        "-ml-px rounded-l-none border-l px-1.5",
        dividerClass,
      )}
      {disabled}
      aria-label={triggerLabel}
    >
      <ChevronDown class="size-3.5" strokeWidth={2.3} />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align={menuAlign} class={menuClass}>
      {@render menu()}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>
