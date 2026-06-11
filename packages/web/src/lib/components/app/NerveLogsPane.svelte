<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Copy from "@lucide/svelte/icons/copy";
  import FilterX from "@lucide/svelte/icons/filter-x";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Search from "@lucide/svelte/icons/search";
  import Tag from "@lucide/svelte/icons/tag";
  import X from "@lucide/svelte/icons/x";
  import { SvelteSet } from "svelte/reactivity";
  import type {
    ApplicationLogLevel,
    ApplicationLogQueryResponse,
    ApplicationLogSource,
  } from "$lib/api";
  import { getApplicationLogs } from "$lib/api";
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

  const expanded = new SvelteSet<string>();

  const rows = $derived([...(logs?.logs ?? [])].reverse());
  const filtersActive = $derived(
    level !== "all" || source !== "all" || component.trim() !== "" || contains.trim() !== "",
  );

  type LogRow = ApplicationLogQueryResponse["logs"][number];

  function refs(log: LogRow): string[] {
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

  function contextEntries(log: LogRow): Array<[string, string]> {
    if (!log.context) return [];
    return Object.entries(log.context).map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ]);
  }

  function hasDetail(log: LogRow): boolean {
    return Boolean(log.error) || contextEntries(log).length > 0 || refs(log).length > 0;
  }

  function toggle(id: string): void {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
  }

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

  function clearFilters() {
    level = "all";
    source = "all";
    component = "";
    contains = "";
  }

  function copyLogs() {
    const text = rows
      .map((log) => `${log.ts} ${log.level.toUpperCase()} ${log.source}/${log.component} ${log.message}`)
      .join("\n");
    void navigator.clipboard?.writeText(text);
  }

  $effect(() => {
    void refresh();
  });
</script>

<section class="logs-pane">
  <header class="logs-toolbar">
    <div class="toolbar-line">
      <div class="segmented" role="group" aria-label="Log level filter">
        {#each levels as option (option)}
          <button type="button" class:active={level === option} onclick={() => (level = option)}>
            {#if option !== "all"}
              <StatusDot size="xs" tone={logLevelTone(option)} />
            {/if}
            {option}
          </button>
        {/each}
      </div>
      <span class="toolbar-divider" aria-hidden="true"></span>
      <div class="segmented" role="group" aria-label="Log source filter">
        {#each sources as option (option)}
          <button type="button" class:active={source === option} onclick={() => (source = option)}>{option}</button>
        {/each}
      </div>
      <div class="toolbar-actions">
        <span class="result-count">{rows.length} {rows.length === 1 ? "entry" : "entries"}</span>
        {#if filtersActive}
          <Button size="sm" variant="ghost" onclick={clearFilters}>
            <FilterX size={13} />Clear
          </Button>
        {/if}
        <Button size="sm" variant="secondary" onclick={refresh} disabled={loading}>
          <RefreshCw size={13} class={loading ? "animate-spin" : ""} />{loading ? "Loading" : "Refresh"}
        </Button>
        <Button size="sm" variant="ghost" onclick={copyLogs} disabled={rows.length === 0}>
          <Copy size={13} />Copy
        </Button>
      </div>
    </div>
    <div class="toolbar-line search-line">
      <label class="field search-field">
        <Search size={13} aria-hidden="true" />
        <Input bind:value={contains} placeholder="Search messages" />
        {#if contains}
          <button type="button" class="field-clear" aria-label="Clear search" onclick={() => (contains = "")}>
            <X size={12} />
          </button>
        {/if}
      </label>
      <label class="field component-field">
        <Tag size={13} aria-hidden="true" />
        <Input bind:value={component} placeholder="Component filter" />
        {#if component}
          <button type="button" class="field-clear" aria-label="Clear component filter" onclick={() => (component = "")}>
            <X size={12} />
          </button>
        {/if}
      </label>
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
      {#each rows as log (log.id)}
        {@const detail = hasDetail(log)}
        {@const open = expanded.has(log.id)}
        <article class={`log-row ${log.level}`} class:open>
          <div class="log-line" data-detail={detail ? "" : undefined}>
            {#if detail}
              <button
                type="button"
                class="caret"
                aria-expanded={open}
                aria-label={open ? "Collapse details" : "Expand details"}
                onclick={() => toggle(log.id)}
              >
                <ChevronRight size={13} />
              </button>
            {:else}
              <span class="caret" aria-hidden="true"></span>
            {/if}
            <span class="time">{timeLabel(log.ts)}</span>
            <span class={`level ${log.level}`}>{log.level}</span>
            <span class="source" title={`${log.source}/${log.component}`}>{log.source}/{log.component}</span>
            <span class="message" title={log.message}>{log.message}</span>
            {#if log.durationMs !== undefined}
              <span class="duration">{log.durationMs}ms</span>
            {/if}
          </div>
          {#if detail && open}
            <div class="log-detail">
              {#if refs(log).length > 0}
                <div class="refs">
                  {#each refs(log) as ref (ref)}<code>{ref}</code>{/each}
                </div>
              {/if}
              {#if contextEntries(log).length > 0}
                <dl class="context">
                  {#each contextEntries(log) as [key, value] (key)}
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  {/each}
                </dl>
              {/if}
              {#if log.error}
                <pre class="error-block">{log.error.stack ?? log.error.message}</pre>
              {/if}
            </div>
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
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--background);
    color: var(--muted-foreground);
    padding: 0.2rem 0.5rem;
    font-size: var(--text-xs);
    text-transform: capitalize;
    cursor: pointer;
    transition:
      color 0.12s ease,
      background 0.12s ease,
      border-color 0.12s ease;
  }

  .segmented button:hover {
    color: var(--foreground);
    border-color: color-mix(in oklab, var(--primary) 40%, var(--border));
  }

  .segmented button.active {
    border-color: var(--primary);
    color: var(--primary-foreground);
    background: var(--primary);
  }

  .toolbar-divider {
    width: 1px;
    align-self: stretch;
    min-height: 1.2rem;
    background: var(--border);
  }

  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-left: auto;
  }

  .result-count {
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .search-line {
    flex-wrap: nowrap;
  }

  .field {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.4rem;
    color: var(--muted-foreground);
  }

  .search-field {
    flex: 1 1 60%;
  }

  .component-field {
    flex: 1 1 30%;
  }

  .search-line :global(input) {
    flex: 1 1 0;
  }

  .field-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
    padding: 0.1rem;
    border-radius: var(--radius-sm);
  }

  .field-clear:hover {
    color: var(--foreground);
    background: var(--accent);
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
    border-bottom: 1px solid color-mix(in oklab, var(--border) 45%, transparent);
    border-left: 2px solid transparent;
    font-family: var(--font-mono);
  }

  .log-row:hover {
    background: color-mix(in oklab, var(--accent) 40%, transparent);
  }

  .log-row.open {
    background: color-mix(in oklab, var(--accent) 30%, transparent);
  }

  .log-row.warn {
    border-left-color: var(--warning);
  }

  .log-row.error {
    border-left-color: var(--destructive);
  }

  .log-line {
    display: grid;
    grid-template-columns:
      1rem
      [time] 7rem
      [level] 4rem
      [source] minmax(6rem, 12rem)
      [message] minmax(0, 1fr)
      [meta] auto;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.18rem 0.6rem 0.18rem 0.15rem;
    line-height: 1.5;
  }

  .caret {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    width: 1rem;
    height: 1rem;
    border: none;
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
    padding: 0;
  }

  .caret:hover {
    color: var(--foreground);
  }

  .log-row.open .caret :global(svg) {
    transform: rotate(90deg);
  }

  .caret :global(svg) {
    transition: transform 0.12s ease;
  }

  .time {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }

  .level {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--muted-foreground);
  }

  .level.info {
    color: var(--foreground);
  }

  .level.warn {
    color: var(--warning);
  }

  .level.error {
    color: var(--destructive);
  }

  .source {
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .message {
    min-width: 0;
    overflow: hidden;
    color: var(--foreground);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .duration {
    justify-self: end;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .log-detail {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.1rem 0.6rem 0.5rem 8.65rem;
  }

  .refs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  code {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.05rem 0.25rem;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .context {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.1rem 0.6rem;
    margin: 0;
  }

  .context dt {
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  .context dd {
    margin: 0;
    color: var(--foreground);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }

  .error-block {
    max-height: 14rem;
    overflow: auto;
    margin: 0;
    border-left: 2px solid color-mix(in oklab, var(--destructive) 60%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--destructive) 6%, transparent);
    padding: 0.4rem 0.6rem;
    color: color-mix(in oklab, var(--destructive) 85%, var(--foreground));
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
