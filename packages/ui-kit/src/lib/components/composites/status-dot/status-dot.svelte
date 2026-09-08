<script lang="ts" module>
import { type VariantProps, tv } from "tailwind-variants";

export const statusDotVariants = tv({
  base: "inline-block flex-none rounded-full",
  variants: {
    tone: {
      neutral:
        "bg-muted-foreground border-muted-foreground text-muted-foreground",
      accent: "bg-foreground border-foreground text-foreground",
      info: "bg-info border-info text-info",
      success: "bg-success border-success text-success",
      warning: "bg-warning border-warning text-warning",
      destructive:
        "bg-destructive-solid border-destructive-solid text-destructive-solid",
    },
    size: {
      xs: "size-[0.42rem]",
      sm: "size-2",
      md: "size-2.5",
    },
    variant: {
      solid: "",
      outline: "border-[1.5px] bg-transparent!",
    },
  },
  defaultVariants: {
    tone: "neutral",
    size: "sm",
    variant: "solid",
  },
});

/* `tone` intentionally mirrors StatusTone from display/status, which is the
 * single source of the vocabulary; this keeps the two in lockstep. */
export type StatusDotSize = NonNullable<
  VariantProps<typeof statusDotVariants>["size"]
>;
export type StatusDotVariant = NonNullable<
  VariantProps<typeof statusDotVariants>["variant"]
>;
</script>

<script lang="ts">
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { cn } from "@nervekit/ui-kit/utils";

let {
  tone = "neutral",
  size = "sm",
  variant = "solid",
  pulse = false,
  label,
  class: className,
}: {
  tone?: StatusTone;
  size?: StatusDotSize;
  variant?: StatusDotVariant;
  pulse?: boolean;
  label?: string;
  class?: string;
} = $props();
</script>

<span
  class={cn(
    statusDotVariants({ tone, size, variant }),
    pulse && "status-pulse",
    className,
  )}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
></span>
