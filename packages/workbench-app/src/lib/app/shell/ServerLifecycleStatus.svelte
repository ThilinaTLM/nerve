<script lang="ts">
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import type { LifecycleView } from "$lib/application/startup/server-lifecycle";

let { view }: { view: LifecycleView } = $props();
</script>

<div class="grid min-w-0 gap-2" role="status" aria-live="polite">
  <div class="flex items-center gap-2">
    <Spinner class="size-4 shrink-0" />
    <p class="text-ui font-medium">{view.status}</p>
  </div>
  {#if view.detail}
    <p class="text-ui text-muted-foreground">{view.detail}</p>
  {/if}
  {#if view.meter}
    <Progress
      value={view.meter.done}
      max={view.meter.total}
      aria-label="Startup progress"
    />
  {/if}
</div>
