<script lang="ts">
  import { flip } from "svelte/animate";
  import { fade } from "svelte/transition";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleDashed from "@lucide/svelte/icons/circle-dashed";
  import FileText from "@lucide/svelte/icons/file-text";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import SearchCode from "@lucide/svelte/icons/search-code";
  import type { ToolCallRecord } from "$lib/api";
  import {
    aggregateExploreTasks,
    type ToolView,
  } from "$lib/features/tools/views/tool-result-view";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "explore" }>;
    onOpenFile?: (path: string, line?: number) => void;
  };
  let { toolCall, view, onOpenFile }: Props = $props();

  const context = $derived((toolCall.args as { context?: unknown })?.context);
  const aggregated = $derived(aggregateExploreTasks(view));
  const tasks = $derived(aggregated.tasks);
  const summary = $derived(aggregated.summary);
  const showHeader = $derived(summary.total > 1);
  const progressPct = $derived(
    summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0,
  );

  function basename(path: string): string {
    return path.split(/[\\/]/).pop() || path;
  }

  function taskTitle(
    task: (typeof tasks)[number],
  ): string {
    return (
      task.label ??
      task.task ??
      (task.index === undefined ? "Explore" : `Explore ${task.index + 1}`)
    );
  }

  function reportMeta(report: NonNullable<(typeof tasks)[number]["report"]>): string | undefined {
    const parts: string[] = [];
    if (report.model) parts.push(report.model.split(/[/:]/).pop() ?? report.model);
    if (report.usage?.turns) parts.push(`${report.usage.turns} turn${report.usage.turns === 1 ? "" : "s"}`);
    if (report.usage?.input || report.usage?.output) {
      parts.push(`${report.usage.input + report.usage.output} tokens`);
    }
    return parts.length > 0 ? parts.join(" · ") : undefined;
  }
</script>

<div class="grid gap-2.5">
  {#if showHeader}
    <header class="grid gap-1.5">
      <div class="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span class="flex min-w-0 items-center gap-2">
          <SearchCode size={14} strokeWidth={2.1} />
          {summary.done ? "Explored codebase" : "Exploring codebase"}
        </span>
        <span class="tabular-nums">{summary.completed}/{summary.total} agents</span>
      </div>
      <div class="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          class="h-full rounded-full transition-[width] duration-500 ease-out {summary.failed > 0 && summary.done ? 'bg-warning' : summary.done ? 'bg-success' : 'bg-info'}"
          style={`width: ${progressPct}%`}
        ></div>
      </div>
    </header>
  {/if}

  {#if tasks.length > 0}
    <ol class="grid gap-1.5">
      {#each tasks as task (task.key)}
        <li
          animate:flip={{ duration: 200 }}
          class="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5"
        >
          <span class="mt-0.5" aria-hidden="true">
            {#if task.status === "completed"}
              <CircleCheck size={16} strokeWidth={2.1} class="text-success" />
            {:else if task.status === "failed"}
              <CircleAlert size={16} strokeWidth={2.1} class="text-destructive" />
            {:else if task.status === "running"}
              <LoaderCircle size={16} strokeWidth={2.1} class="animate-spin text-info" />
            {:else}
              <CircleDashed size={16} strokeWidth={2.1} class="text-muted-foreground" />
            {/if}
          </span>

          <div class="grid min-w-0 gap-1">
            <div class="flex min-w-0 items-baseline gap-2">
              <strong class="truncate text-sm font-medium leading-tight">{taskTitle(task)}</strong>
              {#if task.count && task.count > 1 && task.index !== undefined}
                <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{task.index + 1}/{task.count}</span>
              {/if}
            </div>

            {#if task.status === "completed" && task.report}
              {#if task.report.summaryPreview}
                <p class="m-0 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{task.report.summaryPreview}</p>
              {/if}
              {@const meta = reportMeta(task.report)}
              {#if meta}
                <p class="m-0 text-xs text-muted-foreground">{meta}</p>
              {/if}
              {#if task.report.reportPath}
                <button
                  type="button"
                  transition:fade={{ duration: 150 }}
                  class="mt-0.5 inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs font-medium text-primary hover:bg-muted"
                  onclick={() => task.report?.reportPath && onOpenFile?.(task.report.reportPath)}
                  title={task.report.reportPath}
                >
                  <FileText size={13} strokeWidth={2.1} />
                  Open report
                  <span class="font-mono text-muted-foreground">{basename(task.report.reportPath)}</span>
                </button>
              {/if}
            {:else if task.status === "failed"}
              <p class="m-0 break-words text-sm leading-relaxed text-destructive">{task.error ?? "Explore agent failed."}</p>
              {#if task.report?.steps?.length}
                <p class="m-0 truncate font-mono text-xs text-muted-foreground">{task.report.steps[task.report.steps.length - 1]?.message}</p>
              {/if}
            {:else if task.currentAction}
              <p class="m-0 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span class="truncate {task.currentActionMono ? 'font-mono' : ''}">{task.currentAction}</span>
                {#if task.actionCount > 1}
                  <span class="shrink-0 text-muted-foreground/70">· {task.actionCount} actions</span>
                {/if}
              </p>
            {:else}
              <p class="m-0 text-xs text-muted-foreground">Queued…</p>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  {:else if view.liveLog}
    <pre class="overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs text-muted-foreground">{view.liveLog}</pre>
  {:else if toolCall.status === "running" || toolCall.status === "requested"}
    <p class="flex items-center gap-2 text-sm leading-relaxed text-muted-foreground">
      <LoaderCircle size={14} strokeWidth={2.1} class="animate-spin text-info" />
      Explore agents are working…
    </p>
  {:else}
    <p class="text-sm leading-relaxed text-muted-foreground">Explore completed without report files.</p>
  {/if}

  {#if typeof context === "string" && context.length > 0}
    <p class="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{context}</p>
  {/if}
</div>
