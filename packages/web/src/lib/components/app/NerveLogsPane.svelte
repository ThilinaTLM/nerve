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
  import { ScrollArea } from "$lib/components/ui/scroll-area";
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

  const rows = $derived(logs?.logs ?? []);

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
    const text = rows
      .map((log) => `${log.ts} ${log.level.toUpperCase()} ${log.source}/${log.component} ${log.message}`)
      .join("\n");
    void navigator.clipboard?.writeText(text);
  }

  function refs(log: ApplicationLogQueryResponse["logs"][number]): string[] {
    return [
      log.requestId,
      log.projectId,
      log.conversationId,
      log.agentId,
      log.runId,
      log.toolCallId,
      log.processId,
    ].filter((value): value is string => Boolean(value));
  }

  $effect(() => {
    void refresh();
  });
</script>

<section class="logs-pane">
  <header class="logs-toolbar">
    <div class="toolbar-line">
      <div class="segmented" role="group" aria-label="Log level filter">
        {#each levels as option}
          <button type="button" class:active={level === option} onclick={() => (level = option)}>{option}</button>
        {/each}
      </div>
      <span class="toolbar-divider" aria-hidden="true"></span>
      <div class="segmented" role="group" aria-label="Log source filter">
        {#each sources as option}
          <button type="button" class:active={source === option} onclick={() => (source = option)}>{option}</button>
        {/each}
      </div>
      <div class="toolbar-actions">
        <Button size="sm" variant="secondary" onclick={refresh} disabled={loading}>
          <RefreshCw size={13} class={loading ? "animate-spin" : ""} />{loading ? "Loading" : "Refresh"}
        </Button>
        <Button size="sm" variant="ghost" onclick={copyLogs} disabled={rows.length === 0}>
          <Copy size={13} />Copy
        </Button>
      </div>
    </div>
    <div class="toolbar-line search-line">
      <label class="search-field">
        <Search size={13} aria-hidden="true" />
        <Input bind:value={contains} placeholder="Search messages" />
      </label>
      <Input bind:value={component} placeholder="Component filter" />
    </div>
  </header>

  {#if error}
    <div class="logs-error">{error}</div>
  {/if}

  <ScrollArea class="logs-scroll" type="auto">
    <div class="logs-list" role="log" aria-label="Application logs">
      {#if rows.length === 0 && !loading}
        <div class="empty">No application logs match these filters.</div>
      {/if}
      {#each rows as log}
        <article class={`log-row ${log.level}`}>
          <div class="log-line">
            <span class="time">{timeLabel(log.ts)}</span>
            <Badge size="xs" tone={logLevelTone(log.level)}>
              <StatusDot size="xs" tone={logLevelTone(log.level)} />{log.level}
            </Badge>
            <span class="source">{log.source}/{log.component}</span>
            <span class="message">{log.message}</span>
            {#if log.durationMs !== undefined}
              <code class="duration">{log.durationMs}ms</code>
            {/if}
          </div>
          {#if refs(log).length > 0}
            <div class="refs">
              {#each refs(log) as ref}<code>{ref}</code>{/each}
            </div>
          {/if}
          {#if log.error}
            <pre>{log.error.stack ?? log.error.message}</pre>
          {/if}
        </article>
      {/each}
    </div>
  </ScrollArea>
</section>

<style>
  .logs-pane {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--background);
  }

  .logs-toolbar {
    display: grid;
    gap: 0.5rem;
    position: sticky;
    top: 0;
    z-index: 1;
    border-bottom: 1px solid var(--border);
    background: var(--card);
    padding: 0.6rem 0.75rem;
  }

  .toolbar-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .segmented {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
  }

  .segmented button {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--background);
    color: var(--muted-foreground);
    padding: 0.2rem 0.5rem;
    font-size: var(--text-xs);
    text-transform: capitalize;
    cursor: pointer;
  }

  .segmented button:hover {
    color: var(--foreground);
  }

  .segmented button.active {
    border-color: var(--primary);
    color: var(--foreground);
    background: color-mix(in oklab, var(--primary) 12%, var(--background));
  }

  .toolbar-divider {
    width: 1px;
    align-self: stretch;
    min-height: 1.2rem;
    background: var(--border);
  }

  .toolbar-actions {
    display: flex;
    gap: 0.4rem;
    margin-left: auto;
  }

  .search-line {
    flex-wrap: nowrap;
  }

  .search-field {
    display: grid;
    flex: 1 1 60%;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.4rem;
    color: var(--muted-foreground);
  }

  .search-line :global(input) {
    flex: 1 1 0;
  }

  .logs-error {
    margin: 0.6rem 0.75rem 0;
    border: 1px solid color-mix(in oklab, var(--destructive) 35%, var(--border));
    border-radius: var(--radius-md);
    padding: 0.5rem 0.6rem;
    color: var(--destructive);
    background: color-mix(in oklab, var(--destructive) 8%, var(--card));
    font-size: var(--text-sm);
  }

  :global(.logs-scroll) {
    min-height: 0;
  }

  .logs-list {
    display: flex;
    flex-direction: column;
    padding-bottom: 0.5rem;
  }

  .empty {
    margin: 1rem 0.75rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius-lg);
    padding: 1rem;
    color: var(--muted-foreground);
    text-align: center;
    font-size: var(--text-sm);
  }

  .log-row {
    display: grid;
    gap: 0.25rem;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 55%, transparent);
    border-left: 2px solid transparent;
    padding: 0.3rem 0.75rem;
  }

  .log-row:hover {
    background: color-mix(in oklab, var(--accent) 45%, transparent);
  }

  .log-row.warn {
    border-left-color: var(--warning);
  }

  .log-row.error {
    border-left-color: var(--destructive);
  }

  .log-line {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
  }

  .time {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--success);
  }

  .source {
    flex: none;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  .message {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--foreground);
    font-size: var(--text-sm);
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .refs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    padding-left: 0.25rem;
  }

  code {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.05rem 0.25rem;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .duration {
    flex: none;
    align-self: center;
  }

  pre {
    max-height: 12rem;
    overflow: auto;
    margin: 0.1rem 0 0;
    border-radius: var(--radius-md);
    background: var(--sidebar);
    padding: 0.5rem;
    color: var(--destructive);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    white-space: pre-wrap;
  }
</style>
