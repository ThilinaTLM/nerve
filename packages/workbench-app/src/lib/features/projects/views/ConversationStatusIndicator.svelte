<script lang="ts">
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
import type { ConversationActivity } from "$lib/application/workspace/conversation-activity";
let {
  activity,
  isOpen = false,
}: { activity: ConversationActivity; isOpen?: boolean } = $props();
</script>
{#if activity.indicator !== "idle"}
  <span
    class="flex shrink-0 items-center justify-center"
    role="img"
    aria-label={activity.label}
  >
    <StatusDot
      tone={activity.tone}
      size="md"
      variant={isOpen ? "solid" : "outline"}
      pulse={activity.pulse}
    />
  </span>
{/if}
