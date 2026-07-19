<script lang="ts">
import Circle from "@lucide/svelte/icons/circle";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import CircleQuestionMark from "@lucide/svelte/icons/circle-question-mark";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleX from "@lucide/svelte/icons/circle-x";
import LoaderCircle from "@lucide/svelte/icons/loader-circle";
import type { StatusTone } from "@nervekit/ui-kit/components/ui/status-dot";
import { cn } from "@nervekit/ui-kit/core/utils";

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
  waitingForUser
    ? CircleQuestionMark
    : spin
      ? LoaderCircle
      : terminalIcon[tone],
);
const visualKey = $derived(
  `${waitingForUser ? "waiting" : spin ? "spin" : "static"}:${tone}`,
);
</script>

<span
  class={cn("inline-flex shrink-0 items-center justify-center", className)}
  style:width={`${size}px`}
  style:height={`${size}px`}
>
  {#key visualKey}
    <span
      class="tool-status-glyph inline-flex size-full items-center justify-center"
    >
      <Icon
        {size}
        strokeWidth={2.2}
        class={cn("block", colorClass[tone], spin && "animate-spin")}
        aria-hidden={label ? undefined : "true"}
        aria-label={label}
      />
    </span>
  {/key}
</span>

<style>
.tool-status-glyph {
  animation: tool-status-enter var(--motion-enter-compact-duration)
    var(--motion-enter-easing);
}
</style>
