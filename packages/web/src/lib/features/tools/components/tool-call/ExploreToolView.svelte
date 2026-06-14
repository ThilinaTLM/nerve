<script lang="ts">
  import FileText from "@lucide/svelte/icons/file-text";
  import SearchCode from "@lucide/svelte/icons/search-code";
  import type { ToolCallRecord } from "$lib/api";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "explore" }>;
    onOpenFile?: (path: string, line?: number) => void;
  };
  let { toolCall, view, onOpenFile }: Props = $props();

  const context = $derived((toolCall.args as { context?: unknown })?.context);
  const recentUpdates = $derived(view.liveUpdates.slice(-8));

  function taskLabel(index: number | undefined, count: number | undefined, label: string | undefined) {
    const prefix = index === undefined ? "Explore" : `Explore ${index + 1}${count ? `/${count}` : ""}`;
    return label ? `${prefix} · ${label}` : prefix;
  }
</script>

{#if recentUpdates.length > 0}
  <section class="grid gap-2 rounded-lg border border-border bg-muted/30 p-3" aria-label="Explore live activity">
    <div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <SearchCode size={14} strokeWidth={2.1} /> Live activity
    </div>
    <ol class="grid gap-2">
      {#each recentUpdates as update (`${update.timestamp}-${update.agentId ?? "batch"}-${update.message}`)}
        <li class="grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-sm">
          <span class="mt-1 size-2 rounded-full bg-info" aria-hidden="true"></span>
          <span class="min-w-0">
            <span class="mr-2 text-xs text-muted-foreground">{taskLabel(update.taskIndex, update.taskCount, update.label)}</span>
            <span class="break-words text-foreground">{update.message}</span>
          </span>
        </li>
      {/each}
    </ol>
  </section>
{:else if view.liveLog}
  <pre class="overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs text-muted-foreground">{view.liveLog}</pre>
{/if}

{#if view.reports.length === 0}
  <p class="text-sm leading-relaxed text-muted-foreground">{recentUpdates.length > 0 || view.liveLog ? "Explore agents are working…" : "Explore completed without report files."}</p>
{:else}
  <div class="grid gap-3">
    {#each view.reports as report, index (report.agentId)}
      <article class="grid gap-3 rounded-lg border border-border bg-card p-3">
        <header class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
          <div class="grid size-7 place-items-center rounded-md bg-info/15 text-info" aria-hidden="true">
            <FileText size={15} strokeWidth={2.1} />
          </div>
          <div class="grid min-w-0 gap-1">
            <strong class="text-sm leading-tight">{report.label ?? `Explore ${index + 1}`}</strong>
            <span class="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{report.task}</span>
          </div>
          <code class="font-mono text-xs text-muted-foreground">{report.agentId}</code>
        </header>

        {#if report.summaryPreview}
          <p class="m-0 text-sm leading-relaxed text-muted-foreground">{report.summaryPreview}</p>
        {/if}

        <button
          type="button"
          class="inline-flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5 text-left font-mono text-xs text-info hover:bg-muted"
          onclick={() => onOpenFile?.(report.reportPath)}
          title={report.reportPath}
        >
          <FileText size={14} strokeWidth={2.1} />
          <span class="truncate">{report.reportPath}</span>
        </button>
      </article>
    {/each}
  </div>
{/if}

{#if typeof context === "string" && context.length > 0}
  <p class="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{context}</p>
{/if}
