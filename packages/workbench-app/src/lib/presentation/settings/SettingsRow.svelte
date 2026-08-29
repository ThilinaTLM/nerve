<script lang="ts">
import type { Snippet } from "svelte";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  label?: string;
  description?: string;
  htmlFor?: string;
  layout?: "inline" | "stacked" | "responsive";
  class?: string;
  badges?: Snippet;
  control?: Snippet;
  children?: Snippet;
};

let {
  label,
  description,
  htmlFor,
  layout = "inline",
  class: className,
  badges,
  control,
  children,
}: Props = $props();
</script>

<div
  class={cn(
    "gap-3 py-1.5",
    layout === "inline"
      ? "grid grid-cols-[minmax(0,1fr)_auto] items-center"
      : layout === "responsive"
        ? "grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3"
        : "grid gap-2",
    className,
  )}
>
  {#if label || description || badges}
    <div class="grid min-w-0 gap-0.5">
      <div class="flex min-w-0 items-center gap-2">
        {#if label}
          <Label
            for={htmlFor}
            class="text-sm font-normal text-foreground"
            aria-hidden={htmlFor ? undefined : "true"}>{label}</Label
          >
        {/if}
        {#if badges}
          {@render badges()}
        {/if}
      </div>
      {#if description}
        <p class="text-xs text-muted-foreground">{description}</p>
      {/if}
    </div>
  {/if}

  {#if control}
    <div
      class={cn(
        "min-w-0",
        layout === "inline" && "flex justify-end",
        layout === "responsive" && "sm:flex sm:justify-end",
      )}
    >
      {@render control()}
    </div>
  {/if}

  {#if children}
    {@render children()}
  {/if}
</div>
