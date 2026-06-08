<script lang="ts">
  import Copy from "@lucide/svelte/icons/copy";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Search from "@lucide/svelte/icons/search";
  import type {
    ApplicationLogLevel,
    ApplicationLogQueryResponse,
    ApplicationLogSource,
  } from "$lib/api";
  import { getApplicationLogs } from "$lib/api";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import { logLevelTone } from "$lib/utils/status";
  import { timeLabel } from "$lib/utils/time";

  const levels: Array<ApplicationLogLevel | "all"> = ["all", "debug", "info", "warn", "error"];
  const sources: Array<ApplicationLogSource | "all"> = ["all", "orchestrator", "desktop", "web", "cli"];

  let logs = $state<ApplicationLogQueryResponse | undefined>();
  let level = $state<ApplicationLogLevel | "all">("all");
  let source = $state<ApplicationLogSource | "all">("all");
  let component = $state("");
  let contains = $state("");
  let loading = $state(false);
  let error = $state<string | undefined>();

  async function refresh() {
    loading = true;
    error = undefined;
    try {
      logs = await getApplicationLogs({
        level: level === "all" ? undefined : level,
        source: source === "all" ? undefined : source,
        component: component.trim() || undefined,
        contains: contains.trim() || undefined,
        limit: 160,
      });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading = false;
    }
  }

  function copyLogs() {
    const text = (logs?.logs ?? [])
      .map((log) => `${log.ts} ${log.level.toUpperCase()} ${log.source}/${log.component} ${log.message}`)
      .join("\n");
    void navigator.clipboard?.writeText(text);
  }

  $effect(() => {
    void refresh();
  });
</script>

<section class="logs-tab">
  <header class="logs-toolbar">
    <div class="filter-row segmented" aria-label="Log level filter">
      {#each levels as option}
        <button class:active={level === option} onclick={() => (level = option)}>{option}</button>
      {/each}
    </div>
    <div class="filter-row segmented" aria-label="Log source filter">
      {#each sources as option}
        <button class:active={source === option} onclick={() => (source = option)}>{option}</button>
      {/each}
    </div>
    <label class="search-field">
      <Search size={13} />
      <Input bind:value={contains} placeholder="Search logs" />
    </label>
    <Input bind:value={component} placeholder="Component" />
    <div class="toolbar-actions">
      <Button size="sm" variant="secondary" onclick={refresh} disabled={loading}>
        <RefreshCw size={13} />{loading ? "Loading" : "Refresh"}
      </Button>
      <Button size="sm" variant="ghost" onclick={copyLogs} disabled={(logs?.logs ?? []).length === 0}>
        <Copy size={13} />Copy
      </Button>
    </div>
  </header>

  {#if error}
    <div class="logs-error">{error}</div>
  {/if}

  <div class="logs-list" role="log" aria-label="Application logs">
    {#if (logs?.logs ?? []).length === 0 && !loading}
      <div class="empty">No application logs match these filters.</div>
    {/if}
    {#each logs?.logs ?? [] as log}
      <article class={`log-row ${log.level}`}>
        <div class="log-meta">
          <span class="time">{timeLabel(log.ts)}</span>
          <Badge size="xs" tone={logLevelTone(log.level)}>
            <StatusDot size="xs" tone={logLevelTone(log.level)} />{log.level}
          </Badge>
          <span class="source">{log.source}/{log.component}</span>
        </div>
        <p>{log.message}</p>
        <div class="refs">
          {#if log.requestId}<code>{log.requestId}</code>{/if}
          {#if log.projectId}<code>{log.projectId}</code>{/if}
          {#if log.conversationId}<code>{log.conversationId}</code>{/if}
          {#if log.agentId}<code>{log.agentId}</code>{/if}
          {#if log.runId}<code>{log.runId}</code>{/if}
          {#if log.toolCallId}<code>{log.toolCallId}</code>{/if}
          {#if log.processId}<code>{log.processId}</code>{/if}
          {#if log.durationMs !== undefined}<code>{log.durationMs}ms</code>{/if}
        </div>
        {#if log.error}
          <pre>{log.error.stack ?? log.error.message}</pre>
        {/if}
      </article>
    {/each}
  </div>
</section>

<style>
  .logs-tab {
    display: grid;
    gap: 0.75rem;
    padding: 0.75rem;
  }

  .logs-toolbar {
    display: grid;
    gap: 0.5rem;
  }

  .filter-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .segmented button {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--background);
    color: var(--muted-foreground);
    padding: 0.22rem 0.45rem;
    font-size: var(--text-xs);
    text-transform: capitalize;
  }

  .segmented button.active {
    border-color: var(--primary);
    color: var(--foreground);
    background: color-mix(in oklab, var(--primary) 12%, var(--background));
  }

  .search-field {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.35rem;
    color: var(--muted-foreground);
  }

  .toolbar-actions {
    display: flex;
    gap: 0.4rem;
  }

  .logs-error {
    border: 1px solid color-mix(in oklab, var(--destructive) 35%, var(--border));
    border-radius: var(--radius-md);
    padding: 0.55rem;
    color: var(--destructive);
    background: color-mix(in oklab, var(--destructive) 8%, var(--card));
    font-size: var(--text-sm);
  }

  .logs-list {
    display: grid;
    gap: 0.45rem;
  }

  .empty {
    border: 1px dashed var(--border);
    border-radius: var(--radius-lg);
    padding: 1rem;
    color: var(--muted-foreground);
    text-align: center;
  }

  .log-row {
    display: grid;
    gap: 0.35rem;
    border: 1px solid var(--border);
    border-left-width: 3px;
    border-radius: var(--radius-lg);
    background: var(--background);
    padding: 0.65rem;
  }

  .log-row.warn {
    border-left-color: var(--warning);
  }

  .log-row.error {
    border-left-color: var(--destructive);
  }

  .log-meta,
  .refs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }

  .time {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--success);
  }

  .source {
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  p {
    margin: 0;
    color: var(--foreground);
    font-size: var(--text-sm);
    line-height: 1.35;
  }

  code {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.08rem 0.25rem;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.68rem;
  }

  pre {
    max-height: 12rem;
    overflow: auto;
    border-radius: var(--radius-md);
    background: var(--sidebar);
    padding: 0.5rem;
    color: var(--destructive);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    white-space: pre-wrap;
  }
</style>
