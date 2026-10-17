<script lang="ts">
import Circle from "@lucide/svelte/icons/circle";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleDot from "@lucide/svelte/icons/circle-dot";
import CirclePlay from "@lucide/svelte/icons/circle-play";
import CircleSlash from "@lucide/svelte/icons/circle-slash";
import CircleX from "@lucide/svelte/icons/circle-x";
import type { LaunchStatus } from "@nervekit/contracts/launches";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { cn } from "@nervekit/ui-kit/utils";

let {
  status,
  class: className,
}: {
  status: LaunchStatus | "saved";
  class?: string;
} = $props();

// Every state is a circular glyph so the status column reads as one family.
const presentation = $derived.by(() => {
  switch (status) {
    case "saved":
      return {
        icon: Circle,
        label: "Not run yet",
        color: "text-muted-foreground",
      };
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
        icon: CircleDot,
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
      return {
        icon: CircleAlert,
        label: "Timed out",
        color: "text-destructive",
      };
    case "cancelled":
      return {
        icon: CircleSlash,
        label: "Cancelled",
        color: "text-muted-foreground",
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
