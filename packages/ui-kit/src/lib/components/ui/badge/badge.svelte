<script lang="ts" module>
import type { VariantProps } from "tailwind-variants";
import { cn, tv, type WithElementRef } from "@nervekit/ui-kit/utils";

/* One chip primitive: one colour axis, one height, always borderless.
 * Status meaning is carried by text or an icon, never by colour alone. */
export const badgeVariants = tv({
  base: "h-5 gap-1 rounded-md border border-transparent px-1.5 py-px text-caption font-medium transition-all has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&>svg]:size-3! focus-visible:border-ring focus-visible:ring-focus aria-invalid:ring-destructive-strong aria-invalid:border-destructive aria-invalid:ring-3 group/badge inline-flex w-fit shrink-0 items-center justify-center-safe overflow-hidden whitespace-nowrap transition-colors focus-visible:ring-3 [&>svg]:pointer-events-none",
  variants: {
    variant: {
      neutral: "bg-muted text-muted-foreground",
      brand: "bg-primary-subtle text-primary",
      info: "bg-info-subtle text-info",
      success: "bg-success-subtle text-success",
      warning: "bg-warning-subtle text-warning",
      destructive:
        "bg-destructive-subtle text-destructive focus-visible:ring-destructive-strong",
    },
  },
  defaultVariants: {
    variant: "neutral",
  },
});

export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];
</script>

<script lang="ts">
import type {
  HTMLAnchorAttributes,
  HTMLButtonAttributes,
} from "svelte/elements";

let {
  ref = $bindable(null),
  href,
  onclick,
  class: className,
  variant,
  children,
  ...restProps
}: WithElementRef<HTMLAnchorAttributes> &
  WithElementRef<HTMLButtonAttributes> & {
    variant?: BadgeVariant;
  } = $props();
</script>

{#if onclick && !href}
  <button
    bind:this={ref}
    type="button"
    data-slot="badge"
    class={cn(
      badgeVariants({ variant }),
      "cursor-pointer hover:underline",
      className,
    )}
    {onclick}
    {...restProps}
  >
    {@render children?.()}
  </button>
{:else}
  <svelte:element
    this={href ? "a" : "span"}
    bind:this={ref}
    data-slot="badge"
    {href}
    {onclick}
    class={cn(badgeVariants({ variant }), className)}
    {...restProps}
  >
    {@render children?.()}
  </svelte:element>
{/if}
