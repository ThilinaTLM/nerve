<script lang="ts">
import Bell from "@lucide/svelte/icons/bell";
import ClockAlert from "@lucide/svelte/icons/clock-alert";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleStop from "@lucide/svelte/icons/circle-stop";
import {
  StatusDot,
  type StatusDotSize,
} from "@nervekit/ui-kit/components/composites/status-dot";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { ConversationActivity } from "./conversation-activity";

let {
  activity,
  isOpen = true,
  size = "sm",
}: {
  activity: ConversationActivity;
  /** Tab presence, not selection; only dot-based states use this cue. */
  isOpen?: boolean;
  size?: StatusDotSize;
} = $props();

const colorClass: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  accent: "text-foreground",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

const Icon = $derived(
  activity.indicator === "needs-user"
    ? Bell
    : activity.indicator === "awaiting-async"
      ? ClockAlert
      : activity.indicator === "error"
        ? TriangleAlert
        : activity.indicator === "aborted"
          ? CircleStop
          : activity.indicator === "completed"
            ? CircleCheck
            : undefined,
);
</script>

<span
  class="flex shrink-0 items-center justify-center"
  role="img"
  aria-label={activity.label ?? "Conversation idle"}
  title={activity.label ?? "Conversation idle"}
>
  {#if Icon}
    <Icon class={`size-3 ${colorClass[activity.tone]}`} aria-hidden="true" />
  {:else}
    <!-- An unseen result is an unread-style dot: solid whether or not the tab is open. -->
    <StatusDot
      tone={activity.tone}
      {size}
      variant={isOpen || activity.indicator === "result-ready"
        ? "solid"
        : "outline"}
      pulse={activity.pulse}
    />
  {/if}
</span>
