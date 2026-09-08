<script lang="ts">
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import Circle from "@lucide/svelte/icons/circle";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import CircleQuestionMark from "@lucide/svelte/icons/circle-question-mark";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleX from "@lucide/svelte/icons/circle-x";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";

import { cn } from "@nervekit/ui-kit/utils";

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
const spin = $derived(!waitingForUser && (pulse || tone === "info"));

const colorClass: Record<StatusTone, string> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  neutral: "text-muted-foreground",
  accent: "text-muted-foreground",
};

const terminalIcon = {
  info: Circle,
  success: CircleCheck,
  warning: CircleAlert,
  destructive: CircleX,
  neutral: Circle,
  accent: Circle,
} satisfies Record<StatusTone, typeof Circle>;

const Icon = $derived(waitingForUser ? CircleQuestionMark : terminalIcon[tone]);
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
      {#if spin}
        <Spinner
          style={`width:${size}px;height:${size}px`}
          class={cn("block", colorClass[tone])}
          aria-hidden={label ? undefined : "true"}
          aria-label={label}
        />
      {:else}
        <Icon
          {size}
          strokeWidth={2.2}
          class={cn("block", colorClass[tone])}
          aria-hidden={label ? undefined : "true"}
          aria-label={label}
        />
      {/if}
    </span>
  {/key}
</span>

<style>
.tool-status-glyph {
  animation: tool-status-enter var(--motion-enter-compact-duration)
    var(--motion-enter-easing);
}
</style>
