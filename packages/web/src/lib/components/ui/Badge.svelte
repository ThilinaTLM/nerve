<script lang="ts">
  import type { Snippet } from "svelte";
  import { cva, type VariantProps } from "class-variance-authority";
  import { cn } from "../../utils/cn";

  const badgeVariants = cva(
    "inline-flex items-center gap-1 w-fit max-w-full rounded-full border px-2 py-0.5 font-medium leading-tight whitespace-nowrap",
    {
      variants: {
        tone: {
          neutral: "border-border bg-secondary text-muted-foreground",
          accent: "border-border bg-accent text-foreground",
          running: "border-info/40 bg-info/15 text-info",
          good: "border-success/40 bg-success/15 text-success",
          warn: "border-warning/40 bg-warning/15 text-warning",
          danger: "border-destructive/40 bg-destructive/15 text-destructive",
        },
        size: {
          xs: "px-1.5 py-px text-[11px]",
          sm: "px-2 py-0.5 text-xs",
        },
      },
      defaultVariants: {
        tone: "neutral",
        size: "sm",
      },
    },
  );

  type Tone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;
  type Size = NonNullable<VariantProps<typeof badgeVariants>["size"]>;

  type Props = {
    children?: Snippet;
    class?: string;
    tone?: Tone;
    size?: Size;
    title?: string;
  };

  let { children, class: className = "", tone = "neutral", size = "sm", title }: Props = $props();
</script>

<span class={cn(badgeVariants({ tone, size }), className)} {title}>
  {@render children?.()}
</span>
