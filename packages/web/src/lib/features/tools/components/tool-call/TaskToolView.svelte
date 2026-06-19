<script lang="ts">
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import type { ToolCallRecord } from "$lib/api";
  import { taskTone, taskUrl } from "$lib/features/tools/views/task";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "task_action" }> };
  let { view }: Props = $props();

  const task = $derived(view.task ?? view.tasks?.[0]);
  const url = $derived(task ? taskUrl(task) : undefined);
  const envMeta = $derived(task?.envInfo?.keys.length ? `env ${task.envInfo.keys.length} redacted` : undefined);
  const envKeys = $derived(task?.envInfo?.keys.join(", "));
</script>

{#if task}
  <div class="flex items-center gap-2">
    <StatusDot tone={taskTone(task.status)} pulse={task.status === "starting" || task.status === "stopping"} />
    <span class="text-sm font-semibold capitalize">{task.status}</span>
    {#if task.exitCode !== undefined && task.exitCode !== null}
      <span class="font-mono text-xs text-muted-foreground">exit {task.exitCode}</span>
    {/if}
    {#if task.signal}
      <span class="font-mono text-xs text-muted-foreground">signal {task.signal}</span>
    {/if}
    {#if task.groupId}
      <span class="font-mono text-xs text-muted-foreground">group {task.groupId}</span>
    {/if}
    {#if task.runtime?.childPid}
      <span class="font-mono text-xs text-muted-foreground">pid {task.runtime.childPid}</span>
    {/if}
    {#if task.runtime?.processGroupId}
      <span class="font-mono text-xs text-muted-foreground">pgid {task.runtime.processGroupId}</span>
    {/if}
    {#if task.status === "orphaned" && task.runtime?.platform}
      <span class="font-mono text-xs text-muted-foreground">{task.runtime.platform}</span>
    {/if}
    {#if envMeta}
      <span class="font-mono text-xs text-muted-foreground" title={envKeys}>{envMeta}</span>
    {/if}
  </div>
  <p class="m-0 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">{task.command}</p>
  {#if url}
    <a class="inline-flex items-center gap-1 font-mono text-xs text-info hover:underline" href={url} target="_blank" rel="noreferrer noopener">
      <ExternalLink size={12} strokeWidth={2} />{url}
    </a>
  {/if}
  {#if task.error}
    <p class="m-0 text-xs text-destructive">{task.error}</p>
  {/if}
{/if}
