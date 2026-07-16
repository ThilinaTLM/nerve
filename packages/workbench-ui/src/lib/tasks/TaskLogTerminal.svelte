<script lang="ts">
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import type { TaskLogEvent, TaskLogQueryResponse } from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  VirtualScroller,
  type VirtualScrollerController,
} from "@nervekit/ui-kit/components/ui/virtual-list";
import TerminalText from "../tools/components/tool-call/TerminalText.svelte";

type LogRow =
  | { kind: "history"; key: string }
  | { kind: "command"; key: string; command: string }
  | { kind: "empty"; key: string }
  | { kind: "event"; key: string; event: TaskLogEvent };

type Props = {
  taskId: string;
  taskLogs?: TaskLogQueryResponse;
  command?: string;
  onLoadEarlier?: () => void | Promise<void>;
};

let { taskId, taskLogs, command, onLoadEarlier }: Props = $props();
let controller = $state<VirtualScrollerController>();
let atEnd = $state(true);
let loadingEarlier = $state(false);
let historyError = $state<string | undefined>(undefined);

const rows = $derived.by<LogRow[]>(() => {
  const result: LogRow[] = [{ kind: "history", key: "history" }];
  if (command) result.push({ kind: "command", key: "command", command });
  const events = taskLogs?.events ?? [];
  if (events.length === 0) result.push({ kind: "empty", key: "empty" });
  for (const event of events) {
    result.push({ kind: "event", key: `event:${event.seq}`, event });
  }
  return result;
});

function lineClass(event: TaskLogEvent): string {
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

$effect(() => {
  const viewport = controller?.getViewportElement();
  const canLoad = Boolean(
    taskLogs?.hasMoreBefore && onLoadEarlier && !historyError,
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
      row.kind === "event" ? `${row.event.level}:${row.event.line}` : row.kind}
    heightCacheKey={`task-log:${taskId}`}
    estimateSize={() => 20}
    overscan={16}
    anchor="end"
    followOutput={atEnd}
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
          {#if loadingEarlier}
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
        <pre
          class="pb-2 whitespace-pre-wrap break-words text-foreground">$ {item.command}</pre>
      {:else if item.kind === "empty"}
        <pre
          class="whitespace-pre-wrap break-words text-muted-foreground">No logs captured.</pre>
      {:else}
        <pre
          class={`whitespace-pre-wrap break-words ${lineClass(item.event)}`}><TerminalText
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
      onclick={() => controller?.scrollToEnd({ behavior: "smooth" })}
    >
      <ArrowDown class="size-4" strokeWidth={2.2} />
    </Button>
  {/if}
</div>
