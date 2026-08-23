<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import type { ApplicationLogRecord } from "@nervekit/contracts";
import { timeLabel } from "@nervekit/ui-kit/core/utils/time";
import { hasLogDetail, logContextEntries, logReferences } from "./log-entry";

type Props = {
  log: ApplicationLogRecord;
  open: boolean;
  onToggle: () => void;
};

let { log, open, onToggle }: Props = $props();

const detail = $derived(hasLogDetail(log));
const references = $derived(open ? logReferences(log) : []);
const contextEntries = $derived(open ? logContextEntries(log) : []);
const levelClass = $derived(
  log.level === "warn"
    ? "text-warning"
    : log.level === "error"
      ? "text-destructive"
      : log.level === "info"
        ? "text-foreground"
        : "text-muted-foreground",
);
const summaryTitle = $derived(
  `${timeLabel(log.ts)} ${log.level.toUpperCase()} ${log.source}/${log.component} ${log.message}${log.durationMs === undefined ? "" : ` ${log.durationMs}ms`}`,
);
</script>

{#snippet summary()}
  <span class="mr-2 tabular-nums text-muted-foreground">
    {timeLabel(log.ts)}
  </span>
  <span class={`mr-2 uppercase ${levelClass}`}>{log.level}</span>
  <span class="mr-2 text-muted-foreground">
    {log.source}/{log.component}
  </span>
  <span class="text-foreground">{log.message}</span>
  {#if log.durationMs !== undefined}
    <span class="ml-2 tabular-nums text-muted-foreground">
      {log.durationMs}ms
    </span>
  {/if}
{/snippet}

<article class="select-text font-mono text-xs leading-4">
  <div class="flex min-w-0 items-center px-2 py-0.5">
    {#if detail}
      <button
        type="button"
        class="mr-1 inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-expanded={open}
        aria-label={open ? "Collapse log details" : "Expand log details"}
        title={open ? "Collapse log details" : "Expand log details"}
        onclick={onToggle}
      >
        <ChevronRight
          class={`size-3 transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        />
      </button>
    {:else}
      <span class="mr-1 inline-block size-3.5 shrink-0" aria-hidden="true"
      ></span>
    {/if}
    <div class="min-w-0 flex-1 truncate" title={summaryTitle}>
      {@render summary()}
    </div>
  </div>

  {#if detail && open}
    <div class="flex select-text flex-col gap-1 px-2 pb-1.5 pl-7 text-xs">
      {#if references.length > 0}
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
          {#each references as reference (reference)}
            <span>{reference}</span>
          {/each}
        </div>
      {/if}
      {#if contextEntries.length > 0}
        <dl
          class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5"
        >
          {#each contextEntries as [key, value] (key)}
            <dt class="text-muted-foreground">{key}</dt>
            <dd class="m-0 break-words text-foreground">{value}</dd>
          {/each}
        </dl>
      {/if}
      {#if log.error}
        <pre class="m-0 whitespace-pre-wrap text-xs text-destructive">{log.error
            .stack ?? log.error.message}</pre>
      {/if}
    </div>
  {/if}
</article>
