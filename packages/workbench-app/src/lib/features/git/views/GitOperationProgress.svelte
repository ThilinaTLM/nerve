<script lang="ts">
import type { Activity } from "@nervekit/contracts/activity";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
let {
  activities,
  onCancel,
}: {
  activities: readonly Activity[];
  onCancel?: (id: string) => void | Promise<void>;
} = $props();
</script>

{#each activities as activity (activity.id)}
  <div class="flex flex-col gap-1 border-b px-3 py-2" aria-live="polite">
    <div class="flex items-center gap-2 text-xs">
      <Spinner class="size-3" />
      <span class="min-w-0 flex-1 truncate"
        >{activity.phase ?? activity.title} · {activity.status}</span
      >
      {#if activity.actions.cancel && onCancel}
        <Button
          variant="ghost"
          size="sm"
          onclick={() => void onCancel?.(activity.id)}>Cancel</Button
        >
      {/if}
    </div>
    {#if activity.progress}
      <Progress
        value={Math.min(
          100,
          (activity.progress.completed / activity.progress.total) * 100,
        )}
        aria-label={activity.phase ?? activity.title}
      />
    {/if}
    {#if activity.message}<span class="text-xs text-muted-foreground"
        >{activity.message}</span
      >{/if}
  </div>
{/each}
