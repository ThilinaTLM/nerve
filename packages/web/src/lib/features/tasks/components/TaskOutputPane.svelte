<script lang="ts">
  import Terminal from "@lucide/svelte/icons/terminal";
  import type { TaskLogQueryResponse, TaskRecord } from "$lib/api";
  import TaskLogTerminal from "./TaskLogTerminal.svelte";

  type Props = {
    task?: TaskRecord;
    taskLogs?: TaskLogQueryResponse;
  };

  let { task, taskLogs }: Props = $props();
</script>

<section class="h-full min-h-0 bg-background">
  {#if task}
    <TaskLogTerminal {taskLogs} command={task.command} />
  {:else}
    <div class="grid min-h-full place-content-center gap-1 text-center text-muted-foreground">
      <Terminal class="mx-auto size-7 text-primary" strokeWidth={1.7} />
      <p class="mt-1 text-foreground">Task not found.</p>
      <span class="text-xs">The task may have been removed or is no longer available.</span>
    </div>
  {/if}
</section>
