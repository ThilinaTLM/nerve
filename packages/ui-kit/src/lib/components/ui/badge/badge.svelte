<script lang="ts" module>
import type { VariantProps } from "tailwind-variants";
import { cn, tv, type WithElementRef } from "@nervekit/ui-kit/utils";

/* A badge is a compact label, not a control: it has one colour axis named after
 * the semantic tokens it paints with, and a single height. Status meaning is
 * always carried by the text or an icon, never by colour alone. */
export const badgeVariants = tv({
  base: "h-5 gap-1 rounded-md border border-transparent px-1.5 py-px text-caption font-medium transition-all has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&>svg]:size-3! focus-visible:border-ring focus-visible:ring-focus aria-invalid:ring-destructive-strong aria-invalid:border-destructive aria-invalid:ring-3 group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap transition-colors focus-visible:ring-3 [&>svg]:pointer-events-none",
  variants: {
    variant: {
      neutral: "border-border bg-muted text-foreground",
      brand: "border-primary-strong bg-primary-subtle text-primary",
      outline:
        "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
      info: "border-info-strong bg-info-subtle text-info",
      success: "border-success-strong bg-success-subtle text-success",
      warning: "border-warning-strong bg-warning-subtle text-warning",
      destructive:
        "border-destructive-strong bg-destructive-subtle text-destructive focus-visible:ring-destructive-strong",
    },
  },
  defaultVariants: {
    variant: "neutral",
  },
});

export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];
</script>

<script lang="ts">
import type { HTMLAnchorAttributes } from "svelte/elements";

let {
  ref = $bindable(null),
  href,
  class: className,
  variant,
  children,
  ...restProps
}: WithElementRef<HTMLAnchorAttributes> & {
  variant?: BadgeVariant;
} = $props();
</script>

<svelte:element
  this={href ? "a" : "span"}
  bind:this={ref}
  data-slot="badge"
  {href}
  class={cn(badgeVariants({ variant }), className)}
  {...restProps}
>
  {@render children?.()}
</svelte:element>
