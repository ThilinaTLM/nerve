<script lang="ts">
import type { Component } from "svelte";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import Bell from "@lucide/svelte/icons/bell";
import BellDot from "@lucide/svelte/icons/bell-dot";
import BellRing from "@lucide/svelte/icons/bell-ring";
import Circle from "@lucide/svelte/icons/circle";
import ClockFading from "@lucide/svelte/icons/clock-fading";
import Layers from "@lucide/svelte/icons/layers";
import GitBranch from "@lucide/svelte/icons/git-branch";
import Users from "@lucide/svelte/icons/users";
import Info from "@lucide/svelte/icons/info";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import CircleQuestionMark from "@lucide/svelte/icons/circle-question-mark";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleX from "@lucide/svelte/icons/circle-x";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";

import { cn } from "@nervekit/ui-kit/utils";
import type { CardGlyph } from "./card-presentation";

let {
  tone,
  pulse = false,
  waitingForUser = false,
  size = 14,
  label,
  glyph,
  class: className,
}: {
  tone: StatusTone;
  pulse?: boolean;
  waitingForUser?: boolean;
  size?: number;
  label?: string;
  /**
   * Glyph override. Notices and handed-off work swap the circled tool family
   * for their own vocabulary while keeping tone, sizing and motion identical.
   */
  glyph?: CardGlyph;
  class?: string;
} = $props();

// Drafting/running states spin; HIL waits and terminal states show static
// glyphs. Tone drives the theme color in both cases.
// A named glyph only spins when the caller asks: an overridden glyph carries
// its own meaning, so tone alone must not swap it for a spinner.
const spin = $derived(
  !waitingForUser && (pulse || (!glyph && tone === "info")),
);

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

const glyphIcon = {
  pending: ClockFading,
  bell: Bell,
  "bell-ring": BellRing,
  "bell-dot": BellDot,
  retry: RefreshCw,
  compaction: Layers,
  branch: GitBranch,
  subagent: Users,
  system: Info,
} satisfies Record<CardGlyph, Component>;

const Icon = $derived(
  glyph
    ? glyphIcon[glyph]
    : waitingForUser
      ? CircleQuestionMark
      : terminalIcon[tone],
);
const visualKey = $derived(
  `${waitingForUser ? "waiting" : spin ? "spin" : "static"}:${tone}:${glyph ?? "default"}`,
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
