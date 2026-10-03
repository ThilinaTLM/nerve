<script lang="ts">
import { untrack } from "svelte";
import { prefersReducedMotion } from "svelte/motion";
import { SvelteMap } from "svelte/reactivity";
import {
  acquireHighlightCode,
  type HighlightCodeLease,
} from "@nervekit/ui-kit/highlighting/highlight";
import { fadeAge } from "@nervekit/ui-kit/components/composites/streaming-text";
import { LatestPresentationScheduler } from "@nervekit/ui-kit/scheduling/latest-presentation-scheduler";
import {
  StreamingFadeTracker,
  type FadeSegment,
} from "@nervekit/ui-kit/scheduling/streaming-fade";
import { ansiToHtml } from "@nervekit/ui-kit/terminal/ansi";
import { trimTextPreview } from "@nervekit/ui-kit/display/text-preview";
import {
  computedLineHeightPixels,
  contentWidthFromBorderBox,
  nextFixedVisibleRows,
  parseCssPixels,
  shouldMeasureInlineSize,
  visualRowsFromScrollHeight,
} from "./result-code-block-sizing";

type Props = {
  code: string;
  language?: string;
  maxHeight?: string;
  fixedRows?: number;
  trim?: boolean;
  highlight?: boolean;
  wrap?: boolean;
  overflow?: "auto" | "hidden";
  terminal?: boolean;
  tail?: boolean;
  /** Content is still growing (tail boxes bottom-align only once full). */
  live?: boolean;
  /** Show a streaming caret after the last character. */
  caret?: boolean;
  /**
   * Streaming motion: appended text fades in and, while a live tail box is
   * full, its lines slide up instead of jumping.
   */
  streamMotion?: boolean;
  /** While not fully highlighted, highlight complete lines one by one. */
  progressiveHighlight?: boolean;
  /** Content arrived all at once in this session: fade it in once. */
  enter?: boolean;
  onActivate?: () => void;
  activateLabel?: string;
};

type DiffLineTone = "add" | "delete" | "hunk" | "file" | "context";
type DiffLine = { text: string; tone: DiffLineTone; start: number };

let {
  code,
  language,
  maxHeight = "18rem",
  fixedRows,
  trim = true,
  highlight = true,
  wrap = true,
  overflow = "auto",
  terminal = false,
  tail = false,
  live = false,
  caret = false,
  streamMotion = false,
  progressiveHighlight = false,
  enter = false,
  onActivate,
  activateLabel,
}: Props = $props();

let html = $state<string | undefined>(undefined);
let htmlSignature = $state<string | undefined>(undefined);
let unavailableSignature = $state<string | undefined>(undefined);
let blockEl = $state<HTMLElement | undefined>(undefined);
let viewportEl = $state<HTMLElement | undefined>(undefined);
let contentEl = $state<HTMLElement | undefined>(undefined);
// This lifecycle handle must stay non-reactive: making it a rune creates a
// self-rescheduling effect cycle when the callback clears the pending frame.
const measureState: { frame: number | undefined } = { frame: undefined };

const preview = $derived(trim ? trimTextPreview(code) : { text: code });
const signature = $derived(`${language ?? ""}\0${preview.text}`);
const hasFixedRows = $derived(fixedRows !== undefined && fixedRows > 0);
const terminalHtml = $derived(ansiToHtml(preview.text));
const isDiff = $derived(
  !terminal && (language ?? "").toLowerCase().trim() === "diff",
);
const diffLines = $derived(isDiff ? splitDiffLines(preview.text) : []);

const logicalRowCount = $derived.by(() => {
  if (!hasFixedRows) return 1;
  const text = preview.text;
  const rows = text.length === 0 ? 1 : text.split("\n").length;
  return Math.min(Math.max(rows, 1), fixedRows as number);
});

let maxVisibleRows = $state(0);
/** Measured line height; drives the line slide distance. */
let lineHeightPx = 0;
// Live blocks bottom-align only once full. While they still grow, new rows must
// appear below existing text instead of pushing it up before the measurement.
const tailAligned = $derived(
  tail && (!live || !hasFixedRows || maxVisibleRows >= (fixedRows as number)),
);

function diffLineTone(line: string): DiffLineTone {
  if (line.startsWith("@@")) return "hunk";
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("diff ")
  ) {
    return "file";
  }
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "delete";
  return "context";
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function splitDiffLines(text: string): DiffLine[] {
  let start = 0;
  return normalizeNewlines(text)
    .split("\n")
    .map((line) => {
      const diffLine = { text: line, tone: diffLineTone(line), start };
      start += line.length + 1;
      return diffLine;
    });
}

function updateVisibleRows(measuredRows?: number): void {
  if (!hasFixedRows || fixedRows === undefined) return;
  maxVisibleRows = nextFixedVisibleRows({
    previousRows: maxVisibleRows,
    measuredRows,
    fallbackRows: logicalRowCount,
    fixedRows,
  });
}

function cancelMeasureFrame(): void {
  if (measureState.frame === undefined) return;
  cancelAnimationFrame(measureState.frame);
  measureState.frame = undefined;
}

function measureVisualRows(): void {
  measureState.frame = undefined;
  if (!hasFixedRows || !blockEl || !viewportEl || !contentEl) return;

  let contentWidth = viewportEl.clientWidth;
  if (contentWidth <= 0) {
    const blockRect = blockEl.getBoundingClientRect();
    const blockStyle = getComputedStyle(blockEl);
    contentWidth = contentWidthFromBorderBox({
      borderBoxWidth: blockRect.width,
      paddingLeft: parseCssPixels(blockStyle.paddingLeft),
      paddingRight: parseCssPixels(blockStyle.paddingRight),
      borderLeftWidth: parseCssPixels(blockStyle.borderLeftWidth),
      borderRightWidth: parseCssPixels(blockStyle.borderRightWidth),
    });
  }

  if (contentWidth <= 0) return;

  const contentStyle = getComputedStyle(contentEl);
  const lineHeightPixels = computedLineHeightPixels(
    contentStyle.lineHeight,
    contentStyle.fontSize,
  );
  lineHeightPx = lineHeightPixels;
  updateVisibleRows(
    visualRowsFromScrollHeight(contentEl.scrollHeight, lineHeightPixels),
  );
}

function handleActivationKey(event: KeyboardEvent): void {
  if (!onActivate || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  onActivate();
}

function scheduleMeasure(): void {
  if (!hasFixedRows) return;
  if (measureState.frame !== undefined) return;
  if (typeof requestAnimationFrame === "undefined") {
    measureVisualRows();
    return;
  }
  measureState.frame = requestAnimationFrame(measureVisualRows);
}

$effect(() => {
  if (!hasFixedRows) {
    maxVisibleRows = 0;
    cancelMeasureFrame();
    return;
  }
  updateVisibleRows();
});

$effect(() => {
  // Track compact render revisions rather than allocating a string containing
  // the complete highlighted HTML. Width reflows use the observer below.
  void signature;
  void htmlSignature;
  void terminal;
  void isDiff;
  void fixedRows;
  if (!hasFixedRows) return;
  scheduleMeasure();
});

$effect(() => {
  if (
    !hasFixedRows ||
    !blockEl ||
    !viewportEl ||
    !contentEl ||
    typeof ResizeObserver === "undefined"
  ) {
    return;
  }
  let observedInlineSize: number | undefined;
  const observer = new ResizeObserver((entries) => {
    const entry = entries.at(-1);
    if (!entry) return;
    const nextInlineSize =
      entry.contentBoxSize[0]?.inlineSize ?? entry.contentRect.width;
    if (!shouldMeasureInlineSize(observedInlineSize, nextInlineSize)) return;
    observedInlineSize = nextInlineSize;
    scheduleMeasure();
  });
  observer.observe(viewportEl);
  scheduleMeasure();
  return () => observer.disconnect();
});

$effect(() => {
  return () => cancelMeasureFrame();
});

const fixedRowsVar = $derived(hasFixedRows ? String(fixedRows) : undefined);
const visibleRowsVar = $derived(
  hasFixedRows ? String(Math.max(maxVisibleRows, 1)) : undefined,
);

$effect(() => {
  if (terminal || !highlight || isDiff) {
    html = undefined;
    htmlSignature = undefined;
    unavailableSignature = undefined;
    return;
  }

  const currentSignature = signature;
  if (
    htmlSignature === currentSignature ||
    unavailableSignature === currentSignature
  )
    return;

  const lease = acquireHighlightCode(preview.text, language);
  const result = lease.result;
  if (typeof result === "string") {
    html = result;
    htmlSignature = currentSignature;
    unavailableSignature = undefined;
    lease.release();
    return;
  }
  if (!result) {
    unavailableSignature = currentSignature;
    lease.release();
    return;
  }

  let cancelled = false;
  void result.then((highlighted) => {
    if (cancelled || signature !== currentSignature) return;
    if (highlighted) {
      html = highlighted;
      htmlSignature = currentSignature;
      unavailableSignature = undefined;
    } else {
      unavailableSignature = currentSignature;
    }
  });
  return () => {
    cancelled = true;
    lease.release();
  };
});
// ---- Streaming motion -----------------------------------------------------

const motionEnabled = $derived(streamMotion && !prefersReducedMotion.current);

// Offsets in the fade tracker refer to the displayed text (diffs normalize
// newlines). A tail window that drops leading lines keeps its chunks.
const trackedText = $derived(
  isDiff ? normalizeNewlines(preview.text) : preview.text,
);
const fadeTracker = new StreamingFadeTracker({
  initialText: untrack(() => trackedText),
});
const fadeNow = $derived.by(() => {
  const now = performance.now();
  fadeTracker.update(trackedText, now);
  if (!motionEnabled) fadeTracker.settle();
  return now;
});

function segmentsFor(start: number, end: number): FadeSegment[] {
  return fadeTracker.segments(start, end, fadeNow);
}

const terminalFadeHtml = $derived.by(() => {
  if (!terminal) return "";
  const text = preview.text;
  const segments = segmentsFor(0, text.length);
  if (!segments.some((segment) => segment.fresh)) return terminalHtml;
  // ANSI state that spans a fresh boundary resumes once the line settles.
  return segments
    .map((segment) => {
      const html = ansiToHtml(text.slice(segment.start, segment.end));
      return segment.fresh
        ? `<span class="stream-fresh" style="animation-delay:${-Math.round(segment.ageMs)}ms">${html}</span>`
        : html;
    })
    .join("");
});

// Line slide: while a live tail box is full, appended lines push the content
// up. A windowed tail often keeps its height (a line drops as one arrives),
// so the push is derived from the appended text: newlines in the latest
// append times the measured line height. Each push starts from its offset
// and settles to zero with an additive animation, so overlapping pushes sum
// into one movement. Started from an effect, i.e. before the next paint.
const SLIDE_MS = 170;
const SLIDE_MAX_LINES = 4;
const slideActive = $derived(
  motionEnabled &&
    live &&
    tailAligned &&
    hasFixedRows &&
    maxVisibleRows >= (fixedRows ?? Infinity),
);
let slideStamp: number | undefined;
$effect(() => {
  const stamp = fadeNow;
  const node = contentEl;
  if (stamp === slideStamp) return;
  slideStamp = stamp;
  const appended = fadeTracker.lastAppended;
  if (!slideActive || !node || !appended || lineHeightPx <= 0) return;
  let lines = 0;
  for (let index = appended.start; index < appended.end; index += 1) {
    if (trackedText.charCodeAt(index) === 10) lines += 1;
  }
  if (lines === 0) return;
  const offset = Math.min(lines, SLIDE_MAX_LINES) * lineHeightPx;
  node.animate(
    [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }],
    {
      duration: SLIDE_MS,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      composite: "add",
    },
  );
});

// Final highlight cross-fade: when Shiki colours replace plain text that was
// on screen, they fade in from the plain foreground instead of popping.
const HIGHLIGHT_ENTER_MS = 450;
let highlightEnter = $state(false);
let plainShown = false;
let highlightEnterTimer: ReturnType<typeof setTimeout> | undefined;
$effect(() => {
  const showingHtml = Boolean(highlight && html && htmlSignature === signature);
  if (!showingHtml) {
    plainShown = true;
    return;
  }
  if (!plainShown) return;
  plainShown = false;
  if (!motionEnabled) return;
  highlightEnter = true;
  clearTimeout(highlightEnterTimer);
  highlightEnterTimer = setTimeout(() => {
    highlightEnterTimer = undefined;
    highlightEnter = false;
  }, HIGHLIGHT_ENTER_MS);
});
$effect(() => () => clearTimeout(highlightEnterTimer));

// Progressive highlight: complete lines are highlighted individually (cached
// by line text) so a shifting tail window never loses its colours. The final
// full-text highlight corrects multi-line context under the cross-fade.
type LineHighlight = { html: string; at: number };
const lineHighlights = new SvelteMap<string, LineHighlight>();
// Lease bookkeeping only; nothing renders from it.
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive by design
const pendingLineLeases = new Map<string, HighlightCodeLease>();
const NEWLINE = "\n";
let destroyed = false;
const progressiveActive = $derived(
  progressiveHighlight &&
    !highlight &&
    !terminal &&
    !isDiff &&
    Boolean(language) &&
    !prefersReducedMotion.current,
);

function shikiLineInner(highlighted: string): string | undefined {
  return /<span class="line">([\s\S]*)<\/span><\/code>/.exec(highlighted)?.[1];
}

function storeLineHighlight(line: string, highlighted: string): void {
  const inner = shikiLineInner(highlighted);
  if (inner !== undefined) {
    lineHighlights.set(line, { html: inner, at: performance.now() });
  }
}

function requestLineHighlights(lines: string[]): void {
  if (destroyed) return;
  for (const line of lines) {
    if (!line.trim() || lineHighlights.has(line) || pendingLineLeases.has(line))
      continue;
    const lease = acquireHighlightCode(line, language);
    const result = lease.result;
    if (typeof result === "string") {
      storeLineHighlight(line, result);
      lease.release();
      continue;
    }
    if (!result) {
      lease.release();
      continue;
    }
    pendingLineLeases.set(line, lease);
    void result.then((highlighted) => {
      pendingLineLeases.delete(line);
      lease.release();
      if (!destroyed && highlighted) storeLineHighlight(line, highlighted);
    });
  }
}

const lineHighlightScheduler = new LatestPresentationScheduler<string[]>(
  requestLineHighlights,
  150,
);

$effect(() => {
  if (!progressiveActive) return;
  const lines = preview.text.split("\n");
  lines.pop(); // the active line is still streaming
  lineHighlightScheduler.enqueue(lines);
});

type ProgressiveLine = {
  key: string;
  text: string;
  start: number;
  highlighted?: LineHighlight;
  last: boolean;
};

const progressiveLines = $derived.by<ProgressiveLine[]>(() => {
  if (!progressiveActive) return [];
  const lines = preview.text.split("\n");
  const seen: Record<string, number> = Object.create(null);
  let start = 0;
  return lines.map((text, index) => {
    const occurrence = seen[text] ?? 0;
    seen[text] = occurrence + 1;
    const last = index === lines.length - 1;
    const line = {
      key: `${text}\0${occurrence}`,
      text,
      start,
      highlighted: last ? undefined : lineHighlights.get(text),
      last,
    };
    start += text.length + 1;
    return line;
  });
});

/** Sets a line's colour-fade delay once, at mount, from its highlight age. */
function highlightAge(node: HTMLElement, ageMs: number): void {
  if (ageMs > 0)
    node.style.setProperty("--highlight-delay", `${-Math.round(ageMs)}ms`);
}

$effect(() => () => {
  destroyed = true;
  lineHighlightScheduler.destroy();
  for (const lease of pendingLineLeases.values()) lease.release();
  pendingLineLeases.clear();
});
</script>

{#snippet shikiLine(markup: string)}
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- the inner markup of one Shiki-serialized line. -->
  {@html markup}
{/snippet}

{#snippet fadedText(
  text: string,
  start: number,
  end: number,
)}{#each segmentsFor(start, end) as segment (segment.start)}{#if segment.fresh}<span
        class="stream-fresh"
        use:fadeAge={segment.ageMs}
        >{text.slice(segment.start, segment.end)}</span
      >{:else}{text.slice(segment.start, segment.end)}{/if}{/each}{/snippet}

{#if terminal}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    bind:this={blockEl}
    class="code-block terminal-output"
    class:code-block--interactive={Boolean(onActivate)}
    role={onActivate ? "button" : undefined}
    tabindex={onActivate ? 0 : undefined}
    aria-label={onActivate ? activateLabel : undefined}
    onclick={onActivate}
    onkeydown={handleActivationKey}
    data-terminal="true"
    data-wrap={wrap ? "true" : "false"}
    data-overflow={overflow}
    data-fixed-rows={hasFixedRows ? "true" : undefined}
    data-tail={tailAligned ? "true" : undefined}
    style:--code-block-fixed-rows={fixedRowsVar}
    style:--code-block-visible-rows={visibleRowsVar}
  >
    <div
      bind:this={viewportEl}
      class="code-block__viewport"
      style:max-height={hasFixedRows ? undefined : maxHeight}
    >
      <div
        bind:this={contentEl}
        class="code-block__content"
        class:stream-item-enter={enter}
      >
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- ansiToHtml escapes terminal text and emits only controlled ANSI spans; fade wrappers are fixed markup. -->
        {@html terminalFadeHtml}
      </div>
    </div>
  </div>
{:else if isDiff}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    bind:this={blockEl}
    class="code-block"
    class:code-block--interactive={Boolean(onActivate)}
    role={onActivate ? "button" : undefined}
    tabindex={onActivate ? 0 : undefined}
    aria-label={onActivate ? activateLabel : undefined}
    onclick={onActivate}
    onkeydown={handleActivationKey}
    data-language="diff"
    data-wrap={wrap ? "true" : "false"}
    data-overflow={overflow}
    data-fixed-rows={hasFixedRows ? "true" : undefined}
    data-tail={tailAligned ? "true" : undefined}
    style:--code-block-fixed-rows={fixedRowsVar}
    style:--code-block-visible-rows={visibleRowsVar}
  >
    <div
      bind:this={viewportEl}
      class="code-block__viewport"
      style:max-height={hasFixedRows ? undefined : maxHeight}
    >
      <pre
        bind:this={contentEl}
        class="code-block__content code-block__content--diff"
        class:stream-item-enter={enter}>{#each diffLines as line, index (`${index}:${line.text}`)}<span
            class="diff-line"
            data-tone={line.tone}
            >{@render fadedText(
              trackedText,
              line.start,
              line.start + line.text.length,
            )}{#if caret && index === diffLines.length - 1}<span
                class="code-caret"
                aria-hidden="true"></span>{/if}</span
          >{/each}</pre>
    </div>
  </div>
{:else}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    bind:this={blockEl}
    class="code-block"
    class:code-block--interactive={Boolean(onActivate)}
    role={onActivate ? "button" : undefined}
    tabindex={onActivate ? 0 : undefined}
    aria-label={onActivate ? activateLabel : undefined}
    onclick={onActivate}
    onkeydown={handleActivationKey}
    data-wrap={wrap ? "true" : "false"}
    data-overflow={overflow}
    data-fixed-rows={hasFixedRows ? "true" : undefined}
    data-tail={tailAligned ? "true" : undefined}
    style:--code-block-fixed-rows={fixedRowsVar}
    style:--code-block-visible-rows={visibleRowsVar}
  >
    <div
      bind:this={viewportEl}
      class="code-block__viewport"
      style:max-height={hasFixedRows ? undefined : maxHeight}
    >
      <div
        bind:this={contentEl}
        class="code-block__content"
        class:stream-item-enter={enter}
        data-highlight-enter={highlightEnter ? "" : undefined}
      >
        {#if highlight && html && htmlSignature === signature}
          <!-- eslint-disable-next-line svelte/no-at-html-tags -- Shiki serializes source code into controlled highlighted markup. -->
          {@html html}
        {:else if progressiveActive}
          <pre>{#each progressiveLines as line (line.key)}{#if line.highlighted}<span
                  class="code-line"
                  data-highlight-enter=""
                  use:highlightAge={fadeNow - line.highlighted.at}
                  >{@render shikiLine(line.highlighted.html)}</span
                >{:else}{@render fadedText(
                  preview.text,
                  line.start,
                  line.start + line.text.length,
                )}{/if}{#if !line.last}{NEWLINE}{/if}{/each}{#if caret}<span
                class="code-caret"
                aria-hidden="true"></span>{/if}</pre>
        {:else}
          <pre>{@render fadedText(
              preview.text,
              0,
              preview.text.length,
            )}{#if caret}<span class="code-caret" aria-hidden="true"
              ></span>{/if}</pre>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
.code-block {
  --code-block-padding-y: 10px;
  --code-block-padding-x: 10px;
  --code-block-border-y: 2px;

  box-sizing: border-box;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--well);
  color: var(--foreground);
  padding: var(--code-block-padding-y) var(--code-block-padding-x);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.4;
}

.code-block--interactive {
  cursor: pointer;
}

.code-block--interactive:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.code-block__viewport {
  min-width: 0;
  max-width: 100%;
  overflow: auto;
}

.code-block[data-overflow="hidden"] .code-block__viewport {
  overflow: hidden;
}

.code-block__content {
  margin: 0;
  font: inherit;
  white-space: pre-wrap;
  word-break: break-word;
}

.code-block__content :global(pre) {
  margin: 0;
  background: transparent !important;
  white-space: inherit;
  word-break: inherit;
}

.code-block[data-terminal="true"] {
  line-height: 1.22;
}

.code-block[data-terminal="true"] .code-block__content {
  white-space: pre-wrap;
  word-break: break-word;
}

.code-block[data-wrap="false"] .code-block__content,
.code-block[data-wrap="false"] .code-block__content :global(pre) {
  white-space: pre;
  word-break: normal;
}

.code-block[data-fixed-rows="true"] {
  /* Monotonic grow-then-lock: height follows the rendered visual row count
     * (including wrapping) up to the hard fixed-row cap. The calc explicitly
     * adds the block chrome so the content viewport is exactly N rows tall. */
  height: calc(
    (var(--code-block-visible-rows) * 1lh) + (var(--code-block-padding-y) * 2) +
      var(--code-block-border-y)
  );
  max-height: calc(
    (var(--code-block-fixed-rows) * 1lh) + (var(--code-block-padding-y) * 2) +
      var(--code-block-border-y)
  );
}

/* Syntax colours fade in from plain text: the full highlight swap, and each
 * progressively highlighted line (delay set once at mount from its age). */
.code-block__content[data-highlight-enter] :global(span[style]) {
  animation: code-token-enter 450ms ease-out both;
}

.code-line[data-highlight-enter] :global(span) {
  animation: code-token-enter 450ms ease-out both;
  animation-delay: var(--highlight-delay, 0ms);
}

@media (prefers-reduced-motion: reduce) {
  .code-block__content[data-highlight-enter] :global(span[style]),
  .code-line[data-highlight-enter] :global(span) {
    animation: none;
  }
}

.code-caret {
  display: inline-block;
  width: 0.42em;
  height: 0.42em;
  margin-left: 0.3em;
  border-radius: 9999px;
  background: var(--primary);
  vertical-align: 0.1em;
  animation: stream-caret-breathe 1.1s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .code-caret {
    animation: none;
  }
}

.code-block[data-fixed-rows="true"] .code-block__viewport {
  height: 100%;
  overflow: hidden;
}

.code-block[data-tail="true"] .code-block__viewport {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.code-block :global(code) {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.code-block__content--diff {
  display: block;
}

.diff-line {
  display: block;
  min-height: 1lh;
}

.diff-line:empty::before {
  content: " ";
}

.diff-line[data-tone="add"] {
  color: var(--success);
}

.diff-line[data-tone="delete"] {
  color: var(--destructive);
}

.diff-line[data-tone="hunk"] {
  color: var(--info);
}

.diff-line[data-tone="file"] {
  color: var(--muted-foreground);
}
</style>
