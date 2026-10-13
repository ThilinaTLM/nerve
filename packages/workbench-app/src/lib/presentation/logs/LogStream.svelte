<script lang="ts">
import type { Snippet } from "svelte";
import { tick } from "svelte";
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  VirtualScroller,
  type VirtualScrollerController,
} from "@nervekit/ui-kit/components/composites/virtual-list";
import TerminalText from "$lib/presentation/tools/tool-call/TerminalText.svelte";
import { logStreamToneClass, type LogStreamLine } from "./log-stream";

type Row =
  | { kind: "history"; key: string }
  | { kind: "command"; key: string; command: string }
  | { kind: "empty"; key: string }
  | { kind: "error"; key: string; message: string }
  | { kind: "line"; key: string; line: LogStreamLine };

type Props = {
  /** Identity of the stream; scopes the persisted row-height cache. */
  scopeKey: string;
  lines: readonly LogStreamLine[];
  command?: string;
  ariaLabel: string;
  emptyLabel?: string;
  /** Older output exists before the first line and can be paged in. */
  hasMoreBefore?: boolean;
  /** Older output was discarded and can no longer be loaded. */
  truncated?: boolean;
  onLoadEarlier?: () => void | Promise<void>;
  /** The window no longer contains the live tail (scrolled far back). */
  detached?: boolean;
  /** Reloads the live tail; required for `detached` windows. */
  onJumpToLatest?: () => void | Promise<void>;
  /** Reading the latest output failed; offered as a retry of `onJumpToLatest`. */
  loadError?: string;
  /** Floating controls pinned to the top-right corner. */
  dock?: Snippet;
};

let {
  scopeKey,
  lines,
  command,
  ariaLabel,
  emptyLabel = "No output yet.",
  hasMoreBefore = false,
  truncated = false,
  onLoadEarlier,
  detached = false,
  onJumpToLatest,
  loadError,
  dock,
}: Props = $props();

let controller = $state<VirtualScrollerController>();
let atEnd = $state(true);
let loadingEarlier = $state(false);
let historyError = $state<string | undefined>(undefined);

// The status row exists only while it has something to say.
const historyVisible = $derived(
  loadingEarlier || Boolean(historyError) || (truncated && !hasMoreBefore),
);

const rows = $derived.by<Row[]>(() => {
  const result: Row[] = [];
  if (historyVisible) result.push({ kind: "history", key: "history" });
  if (command) result.push({ kind: "command", key: "command", command });
  if (lines.length === 0 && !loadError)
    result.push({ kind: "empty", key: "empty" });
  for (const line of lines)
    result.push({ kind: "line", key: `line:${line.key}`, line });
  if (loadError)
    result.push({ kind: "error", key: "error", message: loadError });
  return result;
});

// Long lines always wrap; per-line horizontal scrollbars are never acceptable.
const lineClass = "whitespace-pre-wrap break-words";

async function loadEarlier(): Promise<void> {
  if (loadingEarlier || !hasMoreBefore || !onLoadEarlier) return;
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

$effect(() => {
  const viewport = controller?.getViewportElement();
  const canLoad = Boolean(hasMoreBefore && onLoadEarlier && !historyError);
  if (!viewport || !canLoad) return;

  const handleScroll = () => {
    if (viewport.scrollTop <= 48) void loadEarlier();
  };
  viewport.addEventListener("scroll", handleScroll, { passive: true });
  const frame = requestAnimationFrame(handleScroll);
  return () => {
    cancelAnimationFrame(frame);
    viewport.removeEventListener("scroll", handleScroll);
  };
});

async function jumpToLatest(): Promise<void> {
  if (detached && onJumpToLatest) {
    await onJumpToLatest();
    await tick();
  }
  controller?.jumpToEnd();
}
</script>

<div
  class="relative h-full min-h-0 bg-well font-mono text-xs"
  role="log"
  aria-label={ariaLabel}
>
  <VirtualScroller
    bind:controller
    bind:atEnd
    items={rows}
    getKey={(row) => row.key}
    getMeasurementVersion={(row) =>
      row.kind === "line" ? row.line.text : row.kind}
    heightCacheKey={`log-stream:${scopeKey}`}
    estimateSize={() => 20}
    overscan={16}
    anchor="end"
    followOutput={atEnd && !detached}
    scrollEndThreshold={24}
    paddingStart={12}
    paddingEnd={12}
    viewportTabIndex={0}
    viewportAriaLabel={`Scrollable ${ariaLabel.toLowerCase()}`}
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
          {:else}
            Earlier output is no longer retained.
          {/if}
        </div>
      {:else if item.kind === "command"}
        <pre class={`pb-2 text-foreground ${lineClass}`}>$ {item.command}</pre>
      {:else if item.kind === "empty"}
        <pre class={`text-muted-foreground ${lineClass}`}>{emptyLabel}</pre>
      {:else if item.kind === "error"}
        <div class="pt-2 font-sans text-destructive" title={item.message}>
          Could not load output.
          {#if onJumpToLatest}
            <button
              type="button"
              class="rounded-sm underline underline-offset-2 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              onclick={() => void onJumpToLatest?.()}
            >
              Retry
            </button>
          {/if}
        </div>
      {:else}
        <pre
          class={`${lineClass} ${logStreamToneClass(item.line.tone)}`}><TerminalText
            text={item.line.text}
            stream={item.line.stream}
            level={item.line.level}
          /></pre>
      {/if}
    {/snippet}
  </VirtualScroller>

  {#if dock}
    <!-- Positions the dock clear of the viewport's scrollbar lane; only the
         dock itself takes pointer input. -->
    <div
      class="pointer-events-none absolute inset-y-0 right-2.5 left-0 font-sans *:pointer-events-auto"
    >
      {@render dock()}
    </div>
  {/if}

  {#if !atEnd || detached}
    <Button
      size="icon-sm"
      variant="outline"
      class="absolute right-5.5 bottom-3 rounded-full shadow-sm"
      ariaLabel="Jump to latest output"
      title="Jump to latest output"
      onclick={() => void jumpToLatest()}
    >
      <ArrowDown class="size-4" strokeWidth={2.2} />
    </Button>
  {/if}
</div>
