<script lang="ts">
import {
  PageEmptyState,
  PageItem,
  PageList,
} from "@nervekit/ui-kit/components/composites/page";
import Play from "@lucide/svelte/icons/play";
import Timer from "@lucide/svelte/icons/timer";
import { onMount } from "svelte";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { SettingsSection } from "$lib/presentation/settings";
import { jobRunLine } from "./background-jobs-format";
import { BackgroundJobsPageController } from "./background-jobs-page-state.svelte";

const controller = new BackgroundJobsPageController();
let now = $state(Date.now());

onMount(() => {
  controller.start();
  // Relative times ("in 4 min") age without any event.
  const timer = setInterval(() => (now = Date.now()), 15_000);
  return () => {
    clearInterval(timer);
    controller.dispose();
  };
});
</script>

{#if controller.errorMessage}
  <Callout layout="block" tone="destructive" text={controller.errorMessage} />
{/if}

<SettingsSection
  id="jobs"
  title="Jobs"
  description="Work the daemon does on its own while it runs, one job at a time."
  surface={false}
>
  {#if controller.loading}
    <Skeleton class="h-14 w-full" />
  {:else if controller.jobs.length === 0}
    <PageEmptyState
      variant="card"
      icon={Timer}
      title="No background jobs"
      description="Nothing runs in the background right now."
    />
  {:else}
    <PageList ariaLabel="Background jobs">
      {#each controller.jobs as job (job.id)}
        {@const lastError =
          job.lastRun && !job.lastRun.outcome.ok
            ? job.lastRun.outcome.error
            : undefined}
        <PageItem
          title={job.label}
          icon={Timer}
          summary={job.description}
          problem={job.status === "failing" && lastError
            ? `Last run failed: ${lastError}`
            : undefined}
        >
          {#snippet badges()}
            {#if job.status === "running"}
              <Badge variant="info">Running</Badge>
            {:else if job.status === "failing"}
              <Badge variant="warning">Failing</Badge>
            {/if}
          {/snippet}
          {#snippet actions()}
            <IconAction
              icon={Play}
              label="Run now"
              disabled={job.status === "running"}
              onclick={() => void controller.runNow(job.id)}
            />
          {/snippet}
          <span class="block truncate text-caption text-muted-foreground"
            >{jobRunLine(job, now)}</span
          >
        </PageItem>
      {/each}
    </PageList>
  {/if}
</SettingsSection>
