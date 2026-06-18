<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Copy from "@lucide/svelte/icons/copy";
  import FilterX from "@lucide/svelte/icons/filter-x";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Search from "@lucide/svelte/icons/search";
  import Tag from "@lucide/svelte/icons/tag";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import X from "@lucide/svelte/icons/x";
  import { SvelteSet } from "svelte/reactivity";
  import { writeClipboardText } from "$lib/core/clipboard";
  import type {
    ApplicationLogLevel,
    ApplicationLogPruneRequest,
    ApplicationLogQueryResponse,
    ApplicationLogSource,
  } from "$lib/api";
  import { getApplicationLogs, pruneApplicationLogs } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import ConfirmDialog from "$lib/components/ui/confirm-dialog";
  import { Input } from "$lib/components/ui/input";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import { logLevelTone } from "$lib/core/utils/status";
  import { timeLabel } from "$lib/core/utils/time";

  const levels: Array<ApplicationLogLevel | "all"> = ["all", "debug", "info", "warn", "error"];
  const sources: Array<ApplicationLogSource | "all"> = ["all", "orchestrator", "desktop", "web", "cli"];

  let logs = $state<ApplicationLogQueryResponse | undefined>();
  let level = $state<ApplicationLogLevel | "all">("all");
  let source = $state<ApplicationLogSource | "all">("all");
  let component = $state("");
  let contains = $state("");
  let loading = $state(false);
  let pruning = $state(false);
  let confirmPruneOpen = $state(false);
  let error = $state<string | undefined>();
  let notice = $state<string | undefined>();

  const expanded = new SvelteSet<string>();

  const rows = $derived([...(logs?.logs ?? [])].reverse());
  const filtersActive = $derived(
    level !== "all" || source !== "all" || component.trim() !== "" || contains.trim() !== "",
  );
  const pruneDescription = $derived(
    filtersActive
      ? "This removes stored Nerve application logs matching the current filters. New request logs may appear immediately after pruning."
      : "This removes stored Nerve application logs. New request logs may appear immediately after pruning.",
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

  function currentPruneRequest(): ApplicationLogPruneRequest {
    return {
      level: level === "all" ? undefined : level,
      source: source === "all" ? undefined : source,
      component: component.trim() || undefined,
      contains: contains.trim() || undefined,
    };
  }

  async function pruneLogs() {
    pruning = true;
    error = undefined;
    notice = undefined;
    try {
      const response = await pruneApplicationLogs(currentPruneRequest());
      expanded.clear();
      notice = `Pruned ${response.pruned} ${response.pruned === 1 ? "log entry" : "log entries"}.`;
      await refresh();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      pruning = false;
    }
  }

  function copyLogs() {
    const text = rows
      .map((log) => `${log.ts} ${log.level.toUpperCase()} ${log.source}/${log.component} ${log.message}`)
      .join("\n");
    void writeClipboardText(text).catch(() => undefined);
  }

  $effect(() => {
    void refresh();
  });
  import "./nerve-logs-pane.css";
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
        <Button size="sm" variant="secondary" onclick={refresh} disabled={loading || pruning}>
          <RefreshCw size={13} class={loading ? "animate-spin" : ""} />{loading ? "Loading" : "Refresh"}
        </Button>
        <Button size="sm" variant="ghost" onclick={copyLogs} disabled={rows.length === 0 || pruning}>
          <Copy size={13} />Copy
        </Button>
        <Button size="sm" variant="destructive" onclick={() => (confirmPruneOpen = true)} disabled={loading || pruning}>
          <Trash2 size={13} />{pruning ? "Pruning" : "Prune"}
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
  {#if notice}
    <div class="logs-notice">{notice}</div>
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

<ConfirmDialog
  bind:open={confirmPruneOpen}
  title={filtersActive ? "Prune filtered logs?" : "Prune all logs?"}
  description={pruneDescription}
  confirmLabel={filtersActive ? "Prune filtered logs" : "Prune all logs"}
  destructive
  onConfirm={() => void pruneLogs()}
/>
