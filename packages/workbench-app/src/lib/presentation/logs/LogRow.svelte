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
const references = $derived(logReferences(log));
const contextEntries = $derived(logContextEntries(log));
const rowToneClass = $derived(
  log.level === "warn"
    ? "border-l-warning"
    : log.level === "error"
      ? "border-l-destructive-solid"
      : "border-l-transparent",
);
const levelClass = $derived(
  log.level === "warn"
    ? "text-warning"
    : log.level === "error"
      ? "text-destructive"
      : log.level === "info"
        ? "text-foreground"
        : "text-muted-foreground",
);
</script>

<article
  class={`border-b border-l-2 border-b-border/50 font-mono hover:bg-accent/40 ${rowToneClass} ${open ? "bg-accent/30" : ""}`}
>
  <div class="flex min-w-0 items-baseline gap-2 py-0.5 pr-2 pl-0.5">
    {#if detail}
      <button
        type="button"
        class="inline-flex size-4 flex-none self-center items-center justify-center text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        aria-label={open ? "Collapse details" : "Expand details"}
        onclick={onToggle}
      >
        <ChevronRight
          class={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        />
      </button>
    {:else}
      <span class="size-4 flex-none" aria-hidden="true"></span>
    {/if}
    <span class="w-28 flex-none text-xs tabular-nums text-muted-foreground">
      {timeLabel(log.ts)}
    </span>
    <span
      class={`w-16 flex-none text-xs tracking-wide uppercase ${levelClass}`}
    >
      {log.level}
    </span>
    <span
      class="w-48 flex-none truncate text-xs text-muted-foreground"
      title={`${log.source}/${log.component}`}
    >
      {log.source}/{log.component}
    </span>
    <span
      class="min-w-0 flex-1 truncate text-sm text-foreground"
      title={log.message}
    >
      {log.message}
    </span>
    {#if log.durationMs !== undefined}
      <span
        class="ml-auto flex-none text-xs tabular-nums text-muted-foreground"
      >
        {log.durationMs}ms
      </span>
    {/if}
  </div>

  {#if detail && open}
    <div class="flex flex-col gap-1.5 pr-2 pb-2 pl-36">
      {#if references.length > 0}
        <div class="flex flex-wrap gap-1">
          {#each references as reference (reference)}
            <code
              class="rounded-sm border border-border px-1 py-0.5 text-xs text-muted-foreground"
              >{reference}</code
            >
          {/each}
        </div>
      {/if}
      {#if contextEntries.length > 0}
        <dl
          class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-0.5"
        >
          {#each contextEntries as [key, value] (key)}
            <dt class="text-xs text-muted-foreground">{key}</dt>
            <dd class="m-0 break-words text-xs text-foreground">
              {value}
            </dd>
          {/each}
        </dl>
      {/if}
      {#if log.error}
        <pre
          class="m-0 max-h-56 overflow-auto whitespace-pre-wrap rounded-sm border-l-2 border-l-destructive-solid/60 bg-destructive/10 px-2 py-1.5 text-xs leading-relaxed text-destructive">{log
            .error.stack ?? log.error.message}</pre>
      {/if}
    </div>
  {/if}
</article>
