<script lang="ts">
import ExternalLink from "@lucide/svelte/icons/external-link";
import type { TaskToolSummaryPayload } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { StatusDot } from "@nervekit/ui-kit/components/ui/status-dot";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { taskPulse, taskTone } from "@nervekit/ui-kit/core/utils/status";
import { dateTimeLabel } from "@nervekit/ui-kit/core/utils/time";
import { taskUrl } from "../../views/task";

type Props = { task: TaskToolSummaryPayload; dense?: boolean };
let { task, dense = false }: Props = $props();

const url = $derived(taskUrl(task));
const tone = $derived(taskTone(task.status));
const hasExit = $derived(
  task.termination?.exitCode !== undefined &&
    task.termination.exitCode !== null,
);
</script>

<Tooltip.Provider delayDuration={300} disableHoverableContent>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <div
          {...props}
          class="flex min-w-0 items-center gap-2.5 rounded-md border bg-card px-2.5 py-2"
        >
          <StatusDot
            {tone}
            pulse={taskPulse(task.status)}
            size="xs"
            class="flex-none"
          />
          <div
            class="min-w-0 flex-1 {dense
              ? 'truncate'
              : 'whitespace-pre-wrap break-words'} font-mono text-xs text-foreground"
          >
            {task.command}
          </div>
          {#if url}
            <a
              class="inline-flex min-w-0 items-center gap-1 truncate font-mono text-xs text-info hover:underline"
              href={url}
              target="_blank"
              rel="noreferrer noopener"
            >
              <ExternalLink size={12} strokeWidth={2} />{url}
            </a>
          {/if}
          {#if hasExit}<Badge
              tone={task.termination?.exitCode === 0 ? "neutral" : "danger"}
              size="xs">exit {task.termination?.exitCode}</Badge
            >
          {:else if task.termination?.signal}<Badge tone="warn" size="xs"
              >signal {task.termination.signal}</Badge
            >{/if}
          <Badge
            {tone}
            size="xs"
            class={tone === "neutral"
              ? "border-border bg-muted text-muted-foreground"
              : ""}>{task.status}</Badge
          >
        </div>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content
      side="left"
      sideOffset={6}
      class="nav-tooltip task-tooltip"
    >
      <span class="tt-title">{task.name ?? task.command}</span>
      <span class="tt-row"
        ><span class="tt-key">command</span>{task.command}</span
      >
      <span class="tt-row"><span class="tt-key">cwd</span>{task.cwd}</span>
      <span class="tt-row"><span class="tt-key">status</span>{task.status}</span
      >
      <span class="tt-row"
        ><span class="tt-key">started</span>{dateTimeLabel(
          task.timing.startedAt,
        )}</span
      >
      {#if task.lineage?.groupId}<span class="tt-row"
          ><span class="tt-key">group</span>{task.lineage.groupId}</span
        >{/if}
      {#if task.timing.finishedAt}<span class="tt-row"
          ><span class="tt-key">finished</span>{dateTimeLabel(
            task.timing.finishedAt,
          )}</span
        >{/if}
      {#if hasExit}
        <span class="tt-row"
          ><span class="tt-key">exit</span>{task.termination?.exitCode}</span
        >
      {:else if task.termination?.signal}
        <span class="tt-row"
          ><span class="tt-key">signal</span>{task.termination.signal}</span
        >
      {/if}
      {#if task.termination?.error}<span class="tt-row"
          ><span class="tt-key">error</span>{task.termination.error}</span
        >{/if}
      <span class="tt-id">{task.id}</span>
    </Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>

{#if task.termination?.error}
  <p class="m-0 break-words text-xs text-destructive">
    {task.termination.error}
  </p>
{/if}
