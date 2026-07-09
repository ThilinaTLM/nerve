<script lang="ts">
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import type { TaskRecord } from "../../../state/tool-types";
  import { Badge } from "@nervekit/shared-ui/components/ui/badge";
  import { StatusDot } from "@nervekit/shared-ui/components/ui/status-dot";
  import * as Tooltip from "@nervekit/shared-ui/components/ui/tooltip";
  import { taskPulse, taskTone } from "@nervekit/shared-ui/core/utils/status";
  import { dateTimeLabel } from "@nervekit/shared-ui/core/utils/time";
  import { taskUrl } from "../../views/task";

  type Props = { task: TaskRecord; dense?: boolean };
  let { task, dense = false }: Props = $props();

  const url = $derived(taskUrl(task));
  const tone = $derived(taskTone(task.status));
  const envCount = $derived(task.envInfo?.keys.length ?? 0);
  const envKeys = $derived(task.envInfo?.keys.join(", "));
  const envSummary = $derived(
    envCount === 0 ? undefined : `${envCount} redacted ${envCount === 1 ? "var" : "vars"}`,
  );
  const hasExit = $derived(task.exitCode !== undefined && task.exitCode !== null);
</script>

<Tooltip.Provider delayDuration={300} disableHoverableContent>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <div {...props} class="flex min-w-0 items-center gap-2.5 rounded-md border bg-card px-2.5 py-2">
          <StatusDot tone={tone} pulse={taskPulse(task.status)} size="xs" class="flex-none" />
          <div class="min-w-0 flex-1 {dense ? 'truncate' : 'whitespace-pre-wrap break-words'} font-mono text-xs text-foreground">{task.command}</div>
          {#if url}
            <a class="inline-flex min-w-0 items-center gap-1 truncate font-mono text-xs text-info hover:underline" href={url} target="_blank" rel="noreferrer noopener">
              <ExternalLink size={12} strokeWidth={2} />{url}
            </a>
          {/if}
          {#if envCount > 0}<Badge tone="neutral" size="xs" title={envKeys}>env</Badge>{/if}
          {#if hasExit}<Badge tone={task.exitCode === 0 ? "neutral" : "danger"} size="xs">exit {task.exitCode}</Badge>
          {:else if task.signal}<Badge tone="warn" size="xs">signal {task.signal}</Badge>{/if}
          <Badge {tone} size="xs" class={tone === "neutral" ? "border-border bg-muted text-muted-foreground" : ""}>{task.status}</Badge>
        </div>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="left" sideOffset={6} class="nav-tooltip task-tooltip">
      <span class="tt-title">{task.name ?? task.command}</span>
      <span class="tt-row"><span class="tt-key">command</span>{task.command}</span>
      <span class="tt-row"><span class="tt-key">cwd</span>{task.cwd}</span>
      <span class="tt-row"><span class="tt-key">status</span>{task.status}</span>
      {#if envCount > 0}
        <span class="tt-row"><span class="tt-key">env</span>{envSummary}</span>
        <span class="tt-row tt-env-keys"><span class="tt-key">keys</span>{envKeys}</span>
      {/if}
      <span class="tt-row"><span class="tt-key">started</span>{dateTimeLabel(task.startedAt)}</span>
      {#if task.groupId}<span class="tt-row"><span class="tt-key">group</span>{task.groupId}</span>{/if}
      {#if task.runtime?.childPid}<span class="tt-row"><span class="tt-key">pid</span>{task.runtime.childPid}</span>{/if}
      {#if task.runtime?.processGroupId}<span class="tt-row"><span class="tt-key">pgid</span>{task.runtime.processGroupId}</span>{/if}
      {#if task.runtime?.platform}<span class="tt-row"><span class="tt-key">platform</span>{task.runtime.platform}</span>{/if}
      {#if task.runtime?.spawnedAt}<span class="tt-row"><span class="tt-key">spawned</span>{dateTimeLabel(task.runtime.spawnedAt)}</span>{/if}
      {#if task.finishedAt}<span class="tt-row"><span class="tt-key">finished</span>{dateTimeLabel(task.finishedAt)}</span>{/if}
      {#if hasExit}
        <span class="tt-row"><span class="tt-key">exit</span>{task.exitCode}</span>
      {:else if task.signal}
        <span class="tt-row"><span class="tt-key">signal</span>{task.signal}</span>
      {/if}
      {#if task.error}<span class="tt-row"><span class="tt-key">error</span>{task.error}</span>{/if}
      <span class="tt-id">{task.id}</span>
    </Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>

{#if task.error}
  <p class="m-0 break-words text-xs text-destructive">{task.error}</p>
{/if}
