<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import type { TaskEventNotice } from "$lib/core/types/state-types";
  import { taskPulse, taskTone } from "$lib/core/utils/status";

  type Props = { notice: TaskEventNotice };
  let { notice }: Props = $props();

  const tone = $derived(taskTone(notice.status));
  const hasExit = $derived(
    notice.exitCode !== undefined && notice.exitCode !== null,
  );
  const label = $derived(notice.event ? `task ${notice.event}` : "task update");
</script>

<article class="task-event">
  <div class="task-event-header">
    <StatusDot {tone} pulse={taskPulse(notice.status)} size="xs" class="mr-1.5 align-middle" />
    <span class="badge">{label}</span>
    {#if notice.taskName}<span class="arg">{notice.taskName}</span>{/if}
  </div>

  {#if notice.commandPreview || hasExit || notice.signal || notice.status}
    <div class="flex min-w-0 items-center gap-2.5 rounded-md border bg-card px-2.5 py-2">
      <div class="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{notice.commandPreview ?? ""}</div>
      {#if hasExit}
        <Badge tone={notice.exitCode === 0 ? "neutral" : "danger"} size="xs">exit {notice.exitCode}</Badge>
      {:else if notice.signal}
        <Badge tone="warn" size="xs">signal {notice.signal}</Badge>
      {/if}
      {#if notice.status}
        <Badge {tone} size="xs" class={tone === "neutral" ? "border-border bg-muted text-muted-foreground" : ""}>{notice.status}</Badge>
      {/if}
    </div>
  {/if}
</article>

<style>
  .task-event {
    display: grid;
    gap: 0.4rem;
    width: 100%;
    padding: 0.6rem 0.75rem;
  }

  .task-event-header {
    min-width: 0;
    line-height: 1.5;
  }

  .badge {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 650;
    color: var(--foreground);
  }

  .arg {
    margin-left: 0.5rem;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
    word-break: break-word;
  }
</style>
