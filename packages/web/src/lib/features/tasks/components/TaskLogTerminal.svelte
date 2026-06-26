<script lang="ts">
  import type { TaskLogQueryResponse } from "$lib/api";

  type Props = {
    taskLogs?: TaskLogQueryResponse;
    command?: string;
  };

  let { taskLogs, command }: Props = $props();

  function lineClass(event: TaskLogQueryResponse["events"][number]): string {
    if (event.stream === "stderr" || event.level === "error") return "text-destructive";
    if (event.level === "warn") return "text-warning";
    return "text-foreground";
  }
</script>

<div class="log-terminal h-full min-h-0 overflow-auto bg-sidebar p-3 font-mono text-xs leading-relaxed" role="log" aria-label="Task output" aria-live="polite">
  {#if command}
    <pre class="mb-3 whitespace-pre-wrap break-words text-foreground">$ {command}</pre>
  {/if}

  {#if (taskLogs?.events ?? []).length === 0}
    <pre class="whitespace-pre-wrap break-words text-muted-foreground">No logs captured.</pre>
  {:else}
    <div class="grid gap-0.5">
      {#each taskLogs?.events ?? [] as event}
        <pre class={`whitespace-pre-wrap break-words ${lineClass(event)}`}>{event.line}</pre>
      {/each}
    </div>
  {/if}
</div>
