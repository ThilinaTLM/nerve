<script lang="ts">
import Bell from "@lucide/svelte/icons/bell";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import { StatusDot } from "@nervekit/ui-kit/components/ui/status-dot";
import type { ConversationActivityState } from "$lib/kernel/conversations/activity";

let {
  activity,
  isOpen = false,
}: {
  activity: ConversationActivityState;
  isOpen?: boolean;
} = $props();
</script>

<span class="flex shrink-0 items-center justify-center" aria-hidden="true">
  {#if activity.indicator === "needs-user"}
    <Bell class="size-3 text-warning" />
  {:else if activity.indicator === "error"}
    <TriangleAlert class="size-3 text-destructive" />
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
