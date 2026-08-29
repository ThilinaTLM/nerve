<script lang="ts">
import Ban from "@lucide/svelte/icons/ban";
import Bookmark from "@lucide/svelte/icons/bookmark";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleHelp from "@lucide/svelte/icons/circle-help";
import CirclePlay from "@lucide/svelte/icons/circle-play";
import CircleStop from "@lucide/svelte/icons/circle-stop";
import CircleX from "@lucide/svelte/icons/circle-x";
import Radio from "@lucide/svelte/icons/radio";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import TimerOff from "@lucide/svelte/icons/timer-off";
import Unplug from "@lucide/svelte/icons/unplug";
import type { TaskStatus } from "@nervekit/contracts";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { cn } from "@nervekit/ui-kit/utils";

let {
  status,
  class: className,
}: {
  status: TaskStatus | "saved";
  class?: string;
} = $props();

const presentation = $derived.by(() => {
  switch (status) {
    case "saved":
      return { icon: Bookmark, label: "Saved", color: "text-muted-foreground" };
    case "starting":
      return { icon: undefined, label: "Starting", color: "text-warning" };
    case "running":
      return {
        icon: CirclePlay,
        label: "Running",
        color: "text-success",
        pulse: true,
      };
    case "ready":
      return {
        icon: Radio,
        label: "Ready",
        color: "text-success",
        pulse: true,
      };
    case "stopping":
      return { icon: undefined, label: "Stopping", color: "text-warning" };
    case "completed":
      return {
        icon: CircleCheck,
        label: "Completed",
        color: "text-muted-foreground",
      };
    case "failed":
      return { icon: CircleX, label: "Failed", color: "text-destructive" };
    case "timed_out":
      return { icon: TimerOff, label: "Timed out", color: "text-destructive" };
    case "cancelled":
      return { icon: Ban, label: "Cancelled", color: "text-muted-foreground" };
    case "interrupted":
      return { icon: CircleStop, label: "Interrupted", color: "text-warning" };
    case "recovered":
      return { icon: RotateCcw, label: "Recovered", color: "text-warning" };
    case "orphaned":
      return { icon: Unplug, label: "Orphaned", color: "text-destructive" };
    case "recovery_unknown":
      return {
        icon: CircleHelp,
        label: "Recovery unknown",
        color: "text-destructive",
      };
  }
});

const Icon = $derived(presentation.icon);
</script>

<span
  class={cn(
    "inline-flex size-4 shrink-0 items-center justify-center",
    presentation.color,
    presentation.pulse && "animate-pulse",
    className,
  )}
  title={presentation.label}
  aria-label={presentation.label}
  role="img"
>
  {#if Icon}
    <Icon class="size-3.5" strokeWidth={2.2} aria-hidden="true" />
  {:else}
    <Spinner class="size-3.5" aria-hidden="true" />
  {/if}
</span>
