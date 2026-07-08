<script lang="ts">
  import type { TaskLogQueryResponse } from "$lib/api";
  import TerminalText from "@nervekit/shared-ui/tools/components/tool-call/TerminalText.svelte";

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

<div class="log-terminal terminal-output h-full min-h-0 overflow-auto bg-sidebar p-3 font-mono text-xs leading-[1.22]" role="log" aria-label="Task output" aria-live="polite">
  {#if command}
    <pre class="mb-2 whitespace-pre-wrap break-words text-foreground">$ {command}</pre>
  {/if}

  {#if (taskLogs?.events ?? []).length === 0}
    <pre class="whitespace-pre-wrap break-words text-muted-foreground">No logs captured.</pre>
  {:else}
    <div class="grid gap-0">
      {#each taskLogs?.events ?? [] as event}
        <pre class={`whitespace-pre-wrap break-words ${lineClass(event)}`}><TerminalText text={event.line} stream={event.stream} level={event.level} /></pre>
      {/each}
    </div>
  {/if}
</div>
