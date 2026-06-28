<script lang="ts">
  import Circle from "@lucide/svelte/icons/circle";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleQuestionMark from "@lucide/svelte/icons/circle-question-mark";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import type { StatusTone } from "$lib/components/ui/status-dot";
  import { cn } from "$lib/core/utils";

  let {
    tone,
    pulse = false,
    waitingForUser = false,
    size = 14,
    label,
    class: className,
  }: {
    tone: StatusTone;
    pulse?: boolean;
    waitingForUser?: boolean;
    size?: number;
    label?: string;
    class?: string;
  } = $props();

  // Drafting/running states spin; HIL waits and terminal states show static
  // glyphs. Tone drives the theme color in both cases.
  const spin = $derived(!waitingForUser && (pulse || tone === "running"));

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

  const Icon = $derived(
    waitingForUser ? CircleQuestionMark : spin ? LoaderCircle : terminalIcon[tone],
  );
</script>

<Icon
  {size}
  strokeWidth={2.2}
  class={cn("inline-block", colorClass[tone], spin && "animate-spin", className)}
  aria-hidden={label ? undefined : "true"}
  aria-label={label}
/>
