<script lang="ts">
  import Circle from "@lucide/svelte/icons/circle";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import type { StatusTone } from "$lib/components/ui/status-dot";
  import { cn } from "$lib/core/utils";

  let {
    tone,
    pulse = false,
    size = 14,
    label,
    class: className,
  }: {
    tone: StatusTone;
    pulse?: boolean;
    size?: number;
    label?: string;
    class?: string;
  } = $props();

  // Drafting/running (and unresolved waiting) states spin; terminal states show
  // a static check / x / alert glyph. Tone drives the theme color in both cases.
  const spin = $derived(pulse || tone === "running");

  const colorClass: Record<StatusTone, string> = {
    running: "text-info",
    good: "text-success",
    warn: "text-warning",
    danger: "text-destructive",
    neutral: "text-muted-foreground",
    accent: "text-muted-foreground",
  };

  const terminalIcon = {
    running: LoaderCircle,
    good: CircleCheck,
    warn: CircleAlert,
    danger: CircleX,
    neutral: Circle,
    accent: Circle,
  } satisfies Record<StatusTone, typeof Circle>;

  const Icon = $derived(spin ? LoaderCircle : terminalIcon[tone]);
</script>

<Icon
  {size}
  strokeWidth={2.2}
  class={cn("inline-block", colorClass[tone], spin && "animate-spin", className)}
  aria-hidden={label ? undefined : "true"}
  aria-label={label}
/>
