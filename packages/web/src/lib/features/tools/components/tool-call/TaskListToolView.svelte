<script lang="ts">
  import { StatusDot } from "$lib/components/ui/status-dot";
  import type { ToolCallRecord } from "$lib/api";
  import { taskTone, taskUrl } from "$lib/features/tools/views/task";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "task_list" }> };
  let { view }: Props = $props();

  const envMeta = (task: { envInfo?: { keys: string[] } }) => {
    const count = task.envInfo?.keys.length ?? 0;
    return count > 0 ? `env ${count} redacted` : undefined;
  };
  const envKeys = (task: { envInfo?: { keys: string[] } }) => task.envInfo?.keys.join(", ");
</script>

{#if view.tasks.length === 0}
  <p class="m-0 text-xs text-muted-foreground">No tasks.</p>
{:else}
  <ul class="m-0 grid list-none gap-1 rounded-sm border bg-sidebar px-2.5 py-2 text-xs text-sidebar-foreground">
    {#each view.tasks as task (task.id)}
      {@const url = taskUrl(task)}
      <li class="flex min-w-0 items-center gap-2">
        <StatusDot tone={taskTone(task.status)} />
        <span class="truncate font-mono font-semibold">{task.name ?? task.command}</span>
        <span class="capitalize text-muted-foreground">{task.status}</span>
        {#if task.groupId}
          <span class="whitespace-nowrap font-mono text-muted-foreground">group {task.groupId}</span>
        {/if}
        {#if task.runtime?.childPid}
          <span class="whitespace-nowrap font-mono text-muted-foreground">pid {task.runtime.childPid}</span>
        {/if}
        {#if task.runtime?.processGroupId}
          <span class="whitespace-nowrap font-mono text-muted-foreground">pgid {task.runtime.processGroupId}</span>
        {/if}
        {#if task.status === "orphaned" && task.runtime?.platform}
          <span class="whitespace-nowrap font-mono text-muted-foreground">{task.runtime.platform}</span>
        {/if}
        {#if envMeta(task)}
          <span class="whitespace-nowrap font-mono text-muted-foreground" title={envKeys(task)}>{envMeta(task)}</span>
        {/if}
        {#if url}<a class="ml-auto truncate font-mono text-info" href={url} target="_blank" rel="noreferrer noopener">{url}</a>{/if}
      </li>
    {/each}
  </ul>
{/if}
