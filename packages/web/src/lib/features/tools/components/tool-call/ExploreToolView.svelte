<script lang="ts">
  import FileText from "@lucide/svelte/icons/file-text";
  import type { ToolCallDisplayRecord } from "$lib/features/tools/views/tool-result-view";
  import {
    aggregateExploreTasks,
    type ToolView,
  } from "$lib/features/tools/views/tool-result-view";

  type Props = {
    toolCall: ToolCallDisplayRecord;
    view: Extract<ToolView, { kind: "explore" }>;
    onOpenFile?: (path: string, line?: number) => void;
  };
  let { toolCall, view, onOpenFile }: Props = $props();

  const aggregated = $derived(aggregateExploreTasks(view));
  const tasks = $derived(aggregated.tasks);
  function basename(path: string): string {
    return path.split(/[\\/]/).pop() || path;
  }

  /** Short, human display for a model id (drops provider + path prefixes). */
  function modelLabel(model: string): string {
    return model.split(/[/:]/).pop() ?? model;
  }

  function taskTitle(
    task: (typeof tasks)[number],
  ): string {
    return task.label ?? (task.index === undefined ? "Explore" : `Explore ${task.index + 1}`);
  }

  function modelThinkingLabel(task: (typeof tasks)[number]): string | undefined {
    const parts: string[] = [];
    if (task.model) parts.push(modelLabel(task.model));
    if (task.thinkingLevel) parts.push(task.thinkingLevel);
    return parts.length > 0 ? parts.join(" · ") : undefined;
  }

  function placeholderLine(task: (typeof tasks)[number]): string {
    if (task.status === "queued") return "Queued…";
    if (task.status === "running") return "Waiting for first tool…";
    return "No recent activity.";
  }

  function recentDisplayLines(task: (typeof tasks)[number]) {
    const lines = [...task.recentMessages].slice(-3);
    return lines.length > 0
      ? lines
      : [{ text: placeholderLine(task), mono: false }];
  }

  function pluralCount(value: number, noun: string): string {
    return `${value.toLocaleString()} ${noun}${value === 1 ? "" : "s"}`;
  }

  function usageChips(report: NonNullable<(typeof tasks)[number]["report"]>): string[] {
    const chips: string[] = [];
    if (report.usage?.turns) chips.push(pluralCount(report.usage.turns, "turn"));
    const tokenCount = report.usage
      ? report.usage.totalTokens > 0
        ? report.usage.totalTokens
        : report.usage.input + report.usage.output
      : 0;
    if (tokenCount > 0) chips.push(pluralCount(tokenCount, "token"));
    return chips;
  }
</script>

<div class="grid gap-1.5">
  {#if tasks.length > 0}
    <ol class="grid gap-1.5">
      {#each tasks as task (task.key)}
        {@const modelThinking = modelThinkingLabel(task)}
        <li class="grid min-w-0 gap-1 rounded-lg border border-border bg-card px-3 py-2.5">
          <div class="flex min-w-0 items-center gap-2">
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <strong class="min-w-0 truncate text-sm font-medium leading-tight">{taskTitle(task)}</strong>
              {#if modelThinking}
                <span class="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs leading-none text-muted-foreground" title={[task.model, task.thinkingLevel].filter(Boolean).join(" · ")}>{modelThinking}</span>
              {/if}
              {#if task.report?.reportPath}
                <button
                  type="button"
                  class="inline-flex min-w-0 shrink items-center gap-1 rounded border border-border bg-muted/30 px-1.5 py-0.5 text-xs font-medium leading-none text-primary hover:bg-muted"
                  onclick={() => task.report?.reportPath && onOpenFile?.(task.report.reportPath)}
                  title={task.report.reportPath}
                  aria-label={`Open report ${basename(task.report.reportPath)}`}
                >
                  <FileText size={12} strokeWidth={2.1} class="shrink-0" />
                  <span class="min-w-0 truncate font-mono">{basename(task.report.reportPath)}</span>
                </button>
              {/if}
            </div>
            {#if task.count && task.count > 1 && task.index !== undefined}
              <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{task.index + 1}/{task.count}</span>
            {/if}
          </div>

          <div class="grid min-w-0 gap-0.5 text-xs text-muted-foreground">
            {#each recentDisplayLines(task) as line}
              <p class="m-0 truncate {line.mono ? 'font-mono' : ''}">{line.text}</p>
            {/each}
          </div>

          {#if task.report}
            {@const chips = usageChips(task.report)}
            {#if chips.length > 0}
              <div class="flex min-w-0 flex-wrap gap-1 pt-0.5">
                {#each chips as chip}
                  <span class="inline-flex min-h-5 items-center rounded border border-border bg-sidebar px-1.5 py-0.5 text-xs font-medium leading-none tabular-nums text-muted-foreground">{chip}</span>
                {/each}
              </div>
            {/if}
          {/if}
        </li>
      {/each}
    </ol>
  {:else if view.liveLog}
    <pre class="overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs text-muted-foreground">{view.liveLog}</pre>
  {:else if toolCall.status === "running" || toolCall.status === "requested"}
    <p class="text-sm leading-relaxed text-muted-foreground">Explore agents are working…</p>
  {:else}
    <p class="text-sm leading-relaxed text-muted-foreground">Explore completed without report files.</p>
  {/if}
</div>
