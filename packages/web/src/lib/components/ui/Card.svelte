<script lang="ts">
  import type { Snippet } from "svelte";
  import { cva, type VariantProps } from "class-variance-authority";
  import { cn } from "../../utils/cn";

  const cardVariants = cva("rounded-lg border", {
    variants: {
      variant: {
        panel: "border-border bg-card text-card-foreground",
        flat: "border-border bg-muted text-card-foreground",
        elevated: "border-border bg-popover text-popover-foreground shadow-[var(--shadow-elevated)]",
      },
    },
    defaultVariants: {
      variant: "panel",
    },
  });

  type Variant = NonNullable<VariantProps<typeof cardVariants>["variant"]>;

  type Props = {
    children?: Snippet;
    class?: string;
    tone?: "default" | "muted" | "elevated";
    variant?: Variant;
  };

  let {
    children,
    class: className = "",
    tone = "default",
    variant = tone === "elevated" ? "elevated" : tone === "muted" ? "flat" : "panel",
  }: Props = $props();
</script>

<section class={cn(cardVariants({ variant }), className)}>
  {@render children?.()}
</section>
