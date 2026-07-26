<script lang="ts">
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import type { TaskLogEvent, TaskLogQueryResponse } from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  VirtualScroller,
  type VirtualScrollerController,
} from "@nervekit/ui-kit/components/ui/virtual-list";
import TerminalText from "../tools/components/tool-call/TerminalText.svelte";
import {
  compileTaskLogMatcher,
  emptyTaskLogFilter,
  isTaskLogFilterActive,
  type TaskLogFilterState,
} from "./task-log-filter.js";

type LogRow =
  | { kind: "history"; key: string }
  | { kind: "command"; key: string; command: string }
  | { kind: "empty"; key: string }
  | { kind: "event"; key: string; event: TaskLogEvent };

type Props = {
  taskId: string;
  taskLogs?: TaskLogQueryResponse;
  command?: string;
  filter?: TaskLogFilterState;
  wrap?: boolean;
  follow?: boolean;
  onFollowChange?: (follow: boolean) => void;
  onVisibleEventsChange?: (events: readonly TaskLogEvent[]) => void;
  onFilterErrorChange?: (error: string | undefined) => void;
  onLoadEarlier?: () => void | Promise<void>;
};

let {
  taskId,
  taskLogs,
  command,
  filter = emptyTaskLogFilter,
  wrap = true,
  follow = true,
  onFollowChange,
  onVisibleEventsChange,
  onFilterErrorChange,
  onLoadEarlier,
}: Props = $props();
let controller = $state<VirtualScrollerController>();
let atEnd = $state(true);
let loadingEarlier = $state(false);
let historyError = $state<string | undefined>(undefined);

const filterActive = $derived(isTaskLogFilterActive(filter));
const matcher = $derived(compileTaskLogMatcher(filter));
const allEvents = $derived(taskLogs?.events ?? []);
const visibleEvents = $derived(
  filterActive ? allEvents.filter((event) => matcher.match(event)) : allEvents,
);

$effect(() => onVisibleEventsChange?.(visibleEvents));
$effect(() => onFilterErrorChange?.(matcher.error));

const rows = $derived.by<LogRow[]>(() => {
  const result: LogRow[] = [{ kind: "history", key: "history" }];
  if (command && !filterActive)
    result.push({ kind: "command", key: "command", command });
  if (visibleEvents.length === 0) result.push({ kind: "empty", key: "empty" });
  for (const event of visibleEvents) {
    result.push({ kind: "event", key: `event:${event.seq}`, event });
  }
  return result;
});

const lineClass = $derived(
  wrap ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre",
);

function toneClass(event: TaskLogEvent): string {
  if (event.stream === "stderr" || event.level === "error")
    return "text-destructive";
  if (event.level === "warn") return "text-warning";
  return "text-foreground";
}

async function loadEarlier(): Promise<void> {
  if (loadingEarlier || !taskLogs?.hasMoreBefore || !onLoadEarlier) return;
  loadingEarlier = true;
  historyError = undefined;
  try {
    await onLoadEarlier();
  } catch (error) {
    historyError = error instanceof Error ? error.message : String(error);
  } finally {
    loadingEarlier = false;
  }
}

function nearStart(viewport: HTMLDivElement): boolean {
  return viewport.scrollTop <= 48;
}

// Filtering and wrapping change row heights; drop stale measurements.
$effect(() => {
  void filterActive;
  void wrap;
  controller?.measureAll();
});

$effect(() => {
  const viewport = controller?.getViewportElement();
  const canLoad = Boolean(
    taskLogs?.hasMoreBefore && onLoadEarlier && !historyError && !filterActive,
  );
  if (!viewport || !canLoad) return;

  const handleScroll = () => {
    if (nearStart(viewport)) void loadEarlier();
  };
  viewport.addEventListener("scroll", handleScroll, { passive: true });
  const frame = requestAnimationFrame(handleScroll);
  return () => {
    cancelAnimationFrame(frame);
    viewport.removeEventListener("scroll", handleScroll);
  };
});
</script>

<div
  class="relative h-full min-h-0 bg-sidebar font-mono text-xs"
  role="log"
  aria-label="Task output"
>
  <VirtualScroller
    bind:controller
    bind:atEnd
    items={rows}
    getKey={(row) => row.key}
    getMeasurementVersion={(row) =>
      row.kind === "event"
        ? `${row.event.level}:${wrap ? "wrap" : "nowrap"}:${row.event.line}`
        : `${row.kind}:${wrap ? "wrap" : "nowrap"}`}
    heightCacheKey={`task-log:${taskId}:${wrap ? "wrap" : "nowrap"}`}
    estimateSize={() => 20}
    overscan={16}
    anchor="end"
    followOutput={follow && atEnd}
    scrollEndThreshold={24}
    paddingStart={12}
    paddingEnd={12}
    viewportTabIndex={0}
    viewportAriaLabel="Scrollable task output"
    viewportClass="h-full px-3"
  >
    {#snippet row({ item })}
      {#if item.kind === "history"}
        <div class="pb-2 text-center text-muted-foreground">
          {#if filterActive}
            Filtered — {visibleEvents.length} of {allEvents.length} lines
          {:else if loadingEarlier}
            Loading earlier output…
          {:else if historyError}
            <button
              type="button"
              class="rounded-sm text-destructive underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              onclick={() => void loadEarlier()}
            >
              Could not load earlier output. Retry
            </button>
          {:else if taskLogs?.hasMoreBefore}
            Scroll up to load earlier output
          {:else if taskLogs?.truncated}
            Earlier output is no longer retained.
          {:else}
            Beginning of output
          {/if}
        </div>
      {:else if item.kind === "command"}
        <pre class={`pb-2 text-foreground ${lineClass}`}>$ {item.command}</pre>
      {:else if item.kind === "empty"}
        <pre class={`text-muted-foreground ${lineClass}`}>{filterActive
            ? "No lines match the filter."
            : "No logs captured."}</pre>
      {:else}
        <pre class={`${lineClass} ${toneClass(item.event)}`}><TerminalText
            text={item.event.line}
            stream={item.event.stream}
            level={item.event.level}
          /></pre>
      {/if}
    {/snippet}
  </VirtualScroller>

  {#if !atEnd}
    <Button
      size="icon-sm"
      variant="outline"
      class="absolute right-4 bottom-3 rounded-full shadow-sm"
      ariaLabel="Jump to latest output"
      title="Jump to latest output"
      onclick={() => {
        onFollowChange?.(true);
        controller?.scrollToEnd({ behavior: "smooth" });
      }}
    >
      <ArrowDown class="size-4" strokeWidth={2.2} />
    </Button>
  {/if}
</div>
