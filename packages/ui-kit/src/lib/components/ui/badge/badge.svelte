<script lang="ts" module>
import { type VariantProps, tv } from "tailwind-variants";

/* A badge is a compact label, not a control: it has one colour axis named after
 * the semantic tokens it paints with, and a single height. Status meaning is
 * always carried by the text or an icon, never by colour alone. */
export const badgeVariants = tv({
  base: "h-5 gap-1 rounded-md border border-transparent px-1.5 py-px text-xs font-medium transition-all has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&>svg]:size-3! focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive aria-invalid:ring-3 group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap transition-colors focus-visible:ring-3 [&>svg]:pointer-events-none",
  variants: {
    variant: {
      neutral: "border-border bg-muted text-foreground",
      accent: "border-border bg-accent text-foreground",
      outline:
        "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
      info: "border-info/40 bg-info/8 text-info",
      success: "border-success/40 bg-success/8 text-success",
      warning: "border-warning/40 bg-warning/8 text-warning",
      destructive:
        "border-destructive/40 bg-destructive/8 text-destructive focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
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
import { cn, type WithElementRef } from "@nervekit/ui-kit/utils";

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
