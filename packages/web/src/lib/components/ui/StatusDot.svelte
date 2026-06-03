<script lang="ts" module>
  export type StatusTone = "neutral" | "accent" | "good" | "warn" | "danger" | "running";
</script>

<script lang="ts">
  import { cva, type VariantProps } from "class-variance-authority";
  import { cn } from "../../utils/cn";

  const dotVariants = cva("inline-block flex-none rounded-full", {
    variants: {
      tone: {
        neutral: "bg-muted-foreground",
        accent: "bg-foreground",
        running: "bg-info",
        good: "bg-success",
        warn: "bg-warning",
        danger: "bg-destructive",
      },
      size: {
        xs: "size-[0.42rem]",
        sm: "size-2",
        md: "size-2.5",
      },
    },
    defaultVariants: {
      tone: "neutral",
      size: "sm",
    },
  });

  type Tone = NonNullable<VariantProps<typeof dotVariants>["tone"]>;
  type Size = NonNullable<VariantProps<typeof dotVariants>["size"]>;

  type Props = {
    tone?: Tone;
    size?: Size;
    pulse?: boolean;
    label?: string;
    class?: string;
  };

  let {
    tone = "neutral",
    size = "sm",
    pulse = false,
    label,
    class: className = "",
  }: Props = $props();
</script>

<span
  class={cn(dotVariants({ tone, size }), pulse && "status-pulse", className)}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
></span>

<style>
  .status-pulse {
    animation: status-pulse 1.5s ease-in-out infinite;
  }

  @keyframes status-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 45%, transparent);
    }
    50% {
      box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 0%, transparent);
    }
  }
</style>
