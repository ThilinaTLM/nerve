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
  /** Inline after the label: status badges, change indicators. */
  badges?: Snippet;
  /** Inline after the description: a link such as "Manage rules". */
  hint?: Snippet;
  /** Path-like labels only. */
  mono?: boolean;
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
  hint,
  mono = false,
  control,
  children,
}: Props = $props();
</script>

<div
  class={cn(
    "gap-3 py-1.5",
    // In a divided section the row pads itself and the control column has a
    // fixed width so controls align across rows. Narrow panes stack.
    "group-data-settings-divided/surface:min-h-12 group-data-settings-divided/surface:gap-x-4 group-data-settings-divided/surface:px-3 group-data-settings-divided/surface:py-2",
    layout === "inline"
      ? "grid grid-cols-[minmax(0,1fr)_auto] items-center group-data-settings-divided/surface:grid-cols-1 group-data-settings-divided/surface:@md/settings-page:grid-cols-[minmax(0,1fr)_14rem]"
      : layout === "responsive"
        ? "grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3 group-data-settings-divided/surface:sm:grid-cols-[minmax(0,1fr)_14rem]"
        : "grid gap-2",
    className,
  )}
>
  {#if label || description || badges || hint}
    <div class="grid min-w-0 gap-0.5">
      <div class="flex min-w-0 items-center gap-2">
        {#if label}
          <Label
            for={htmlFor}
            class={cn(
              "text-ui font-normal text-foreground",
              mono && "font-mono",
            )}
            aria-hidden={htmlFor ? undefined : "true"}>{label}</Label
          >
        {/if}
        {#if badges}
          {@render badges()}
        {/if}
      </div>
      {#if description || hint}
        <p
          class="flex flex-wrap items-center gap-x-1.5 text-caption text-muted-foreground"
        >
          {description}
          {#if hint}{@render hint()}{/if}
        </p>
      {/if}
    </div>
  {/if}

  {#if control}
    <div
      class={cn(
        "min-w-0",
        layout === "inline" && "flex items-center justify-end",
        "group-data-settings-divided/surface:flex group-data-settings-divided/surface:items-center group-data-settings-divided/surface:justify-end group-data-settings-divided/surface:gap-2",
        layout === "responsive" && "sm:flex sm:items-center sm:justify-end",
      )}
    >
      {@render control()}
    </div>
  {/if}

  {#if children}
    {@render children()}
  {/if}
</div>
