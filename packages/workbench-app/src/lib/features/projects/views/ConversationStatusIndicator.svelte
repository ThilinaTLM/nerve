<script lang="ts">
import Bell from "@lucide/svelte/icons/bell";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleStop from "@lucide/svelte/icons/circle-stop";
import Hourglass from "@lucide/svelte/icons/hourglass";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
import type { ConversationActivityState } from "$lib/domain/projects/sidebar-view-models";

let {
  activity,
  isOpen = false,
}: {
  activity: ConversationActivityState;
  isOpen?: boolean;
} = $props();
</script>

<span
  class="flex shrink-0 items-center justify-center"
  role="img"
  aria-label={activity.label ?? "Conversation idle"}
>
  {#if activity.indicator === "needs-user"}
    <Bell class="size-3 text-warning" />
  {:else if activity.indicator === "awaiting-async"}
    <Hourglass class="size-3 text-warning" />
  {:else if activity.indicator === "error"}
    <TriangleAlert class="size-3 text-destructive" />
  {:else if activity.indicator === "aborted"}
    <CircleStop class="size-3 text-muted-foreground" />
  {:else if activity.indicator === "completed"}
    <CircleCheck class="size-3 text-muted-foreground" />
  {:else}
    <StatusDot
      tone={activity.tone}
      size="md"
      variant={isOpen ? "solid" : "outline"}
      pulse={activity.pulse}
    />
  {/if}
</span>
