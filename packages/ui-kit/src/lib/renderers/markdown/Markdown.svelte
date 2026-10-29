<script lang="ts">
import { mount, tick, unmount, untrack } from "svelte";
import { prefersReducedMotion } from "svelte/motion";
import CodeCopyButton from "./CodeCopyButton.svelte";
import {
  decorateMarkdownHtml,
  getHighlightedMarkdownSync,
  renderBestAvailableMarkdown,
  renderDecoratedMarkdown,
  renderHighlightedMarkdown,
  renderMarkdown,
} from "@nervekit/ui-kit/renderers/markdown/markdown-render";
import {
  extractMermaidMarkdownBlocks,
  type MermaidMarkdownBlock,
} from "@nervekit/ui-kit/renderers/mermaid/mermaid-blocks";
import {
  appendedNewline,
  splitStreamingMarkdown,
} from "@nervekit/ui-kit/renderers/markdown/streaming-markdown";
import { splitRevealedMarkdown } from "./streaming-inline.js";
import { LatestPresentationScheduler } from "@nervekit/ui-kit/scheduling/latest-presentation-scheduler";
import { revealBoundary } from "@nervekit/ui-kit/scheduling/streaming-reveal";
import { StreamingRevealLoop } from "@nervekit/ui-kit/scheduling/streaming-reveal-loop";
import { StreamingFadeTracker } from "@nervekit/ui-kit/scheduling/streaming-fade";
import {
  parseLocalFileHref,
  resolveDisplayPath,
  splitPathLineSuffix,
} from "@nervekit/ui-kit/display/path-links";
import { observeMermaidVisibility } from "../mermaid/mermaid-visibility.js";
import MermaidDiagram from "../mermaid/MermaidDiagram.svelte";
import StreamingTail from "./StreamingTail.svelte";

type Props = {
  text: string;
  trimCodeBlocks?: boolean;
  /** Convert Markdown soft line endings into semantic hard breaks. */
  preserveLineBreaks?: boolean;
  /** Bound streaming work while deferring Shiki until completion. */
  streaming?: boolean;
  /** Pace streaming text into view per frame instead of in bursts. */
  reveal?: boolean;
  /** Show a live caret at the end of streaming text. */
  caret?: boolean;
  linkBasePath?: string;
  onOpenFile?: (path: string, line?: number) => void;
  onOpenMermaid?: (block: MermaidMarkdownBlock) => void;
  sourceLineStart?: number;
  onCopy?: (ok: boolean) => void;
};

type StreamingValue = {
  source: string;
  trim: boolean;
  preserveLineBreaks: boolean;
};

let {
  text,
  trimCodeBlocks = true,
  preserveLineBreaks = false,
  streaming = false,
  reveal = false,
  caret = false,
  linkBasePath,
  onOpenFile,
  onOpenMermaid,
  sourceLineStart = 1,
  onCopy,
}: Props = $props();

function renderStreamingPrefix(
  source: string,
  trim: boolean,
  preserveBreaks: boolean,
): string {
  if (!source) return "";
  return decorateMarkdownHtml(
    renderMarkdown(source, {
      cache: false,
      preserveLineBreaks: preserveBreaks,
    }),
    trim,
  );
}

/** The optimistic tail keeps the caret on the last block between blocks. */
function splitForDisplay(source: string) {
  return reveal && !prefersReducedMotion.current
    ? splitRevealedMarkdown(source)
    : splitStreamingMarkdown(source);
}

const initialRender = untrack(() => {
  const parts = streaming ? splitForDisplay(text) : undefined;
  return {
    html: streaming
      ? ""
      : renderBestAvailableMarkdown(text, trimCodeBlocks, preserveLineBreaks),
    prefixHtml: parts
      ? renderStreamingPrefix(parts.prefix, trimCodeBlocks, preserveLineBreaks)
      : "",
    prefixSource: parts?.prefix ?? "",
    tail: parts?.tail ?? "",
    streaming,
    source: text,
    trim: trimCodeBlocks,
    preserveLineBreaks,
  };
});
let html = $state(initialRender.html);
let streamingPrefixHtml = $state(initialRender.prefixHtml);
let streamingPrefixSource = $state(initialRender.prefixSource);
let streamingPrefixTrim = initialRender.trim;
let streamingPrefixPreserveLineBreaks = initialRender.preserveLineBreaks;
let streamingTail = $state(initialRender.tail);
let showingStreaming = $state(initialRender.streaming);
let lastEnqueuedSource = initialRender.source;
let lastEnqueuedTrim = initialRender.trim;
let lastEnqueuedPreserveLineBreaks = initialRender.preserveLineBreaks;
let highlightToken = 0;

async function handleClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!onOpenFile) return;
  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  const href = anchor?.getAttribute("href");
  if (!href) return;
  const parsed = parseLocalFileHref(href);
  if (!parsed) return;
  const split = splitPathLineSuffix(parsed);
  const path = linkBasePath
    ? (resolveDisplayPath(split.path, linkBasePath) ?? split.path)
    : split.path;
  event.preventDefault();
  onOpenFile(path, split.line);
}

type HtmlContentValue = {
  html: string;
  /** Markdown source the HTML was rendered from (for Mermaid extraction). */
  source: string;
  sourceLineStart: number;
  onOpenMermaid?: (block: MermaidMarkdownBlock) => void;
};

function nearestVerticalScrollRoot(root: HTMLElement): Element | null {
  const document = root.ownerDocument;
  for (let parent = root.parentElement; parent; parent = parent.parentElement) {
    if (parent === document.body || parent === document.documentElement) break;
    const overflowY = getComputedStyle(parent).overflowY;
    if (
      /^(auto|overlay|scroll)$/u.test(overflowY) &&
      parent.scrollHeight > parent.clientHeight
    )
      return parent;
  }
  return null;
}

function createMermaidPlaceholder(host: HTMLElement): void {
  const placeholder = host.ownerDocument.createElement("div");
  placeholder.className =
    "grid h-full place-items-center p-4 text-sm text-muted-foreground";
  placeholder.textContent = "Mermaid diagram";
  placeholder.setAttribute("aria-hidden", "true");
  host.setAttribute("aria-busy", "true");
  host.replaceChildren(placeholder);
}

/** Mount a lazily rendered diagram into one host; returns its teardown. */
function enhanceMermaidHost(
  root: HTMLElement,
  host: HTMLElement,
  extracted: MermaidMarkdownBlock | undefined,
  onOpenMermaid: ((block: MermaidMarkdownBlock) => void) | undefined,
): () => void {
  const source =
    extracted?.source ?? host.querySelector("pre > code")?.textContent ?? "";
  if (!source.trim()) return () => {};
  const ariaLabel = host.getAttribute("aria-label") ?? "Mermaid diagram";
  createMermaidPlaceholder(host);
  let component: Record<string, unknown> | undefined;
  let active = true;
  const stopObserving = observeMermaidVisibility([host], {
    root: nearestVerticalScrollRoot(root),
    mount: () => {
      if (!active || !host.isConnected) return;
      host.removeAttribute("aria-busy");
      host.replaceChildren();
      component = mount(MermaidDiagram, {
        target: host,
        props: {
          source,
          ariaLabel,
          class: "h-full w-full",
          onOpenStandalone:
            extracted && onOpenMermaid
              ? () => onOpenMermaid(extracted)
              : undefined,
        },
      });
    },
  });
  return () => {
    active = false;
    stopObserving();
    if (component) void unmount(component);
  };
}

function nodeSignature(node: Node): string {
  return node instanceof Element
    ? node.outerHTML
    : `#${node.nodeType}:${node.textContent ?? ""}`;
}

/**
 * Owns the rendered Markdown HTML. Updates keep every leading top-level node
 * whose rendered markup is unchanged and replace only the rest, so a growing
 * streaming prefix appends blocks instead of rebuilding the whole message:
 * finished Mermaid diagrams, copy buttons, and selections survive each new
 * paragraph, and the final render reuses whatever it shares with the stream.
 */
function htmlContent(node: HTMLDivElement, initial: HtmlContentValue) {
  let value = initial;
  let nodes: Node[] = [];
  let signatures: string[] = [];
  // Imperative DOM bookkeeping, never read by the template.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive by design
  const copyButtons = new Map<HTMLElement, ReturnType<typeof mount>>();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive by design
  const diagrams = new Map<HTMLElement, () => void>();
  let mermaidGeneration = 0;

  function reconcile(html: string) {
    const template = node.ownerDocument.createElement("template");
    template.innerHTML = html;
    const next = [...template.content.childNodes];
    const nextSignatures = next.map(nodeSignature);
    let keep = 0;
    while (
      keep < nodes.length &&
      keep < next.length &&
      signatures[keep] === nextSignatures[keep]
    ) {
      keep += 1;
    }
    for (const stale of nodes.slice(keep)) stale.parentNode?.removeChild(stale);
    const added = next.slice(keep);
    node.append(...added);
    nodes = [...nodes.slice(0, keep), ...added];
    signatures = [...signatures.slice(0, keep), ...nextSignatures.slice(keep)];
  }

  function enhanceCopyButtons() {
    for (const [target, button] of copyButtons) {
      if (node.contains(target)) continue;
      void unmount(button);
      copyButtons.delete(target);
    }
    for (const target of node.querySelectorAll<HTMLElement>(
      "[data-copy-code]",
    )) {
      if (copyButtons.has(target)) continue;
      const code =
        target.closest(".code-block")?.querySelector("pre code")?.textContent ??
        "";
      copyButtons.set(
        target,
        mount(CodeCopyButton, {
          target,
          props: { code, onCopy: (ok: boolean) => onCopy?.(ok) },
        }),
      );
    }
  }

  function clearDiagrams() {
    for (const destroy of diagrams.values()) destroy();
    diagrams.clear();
  }

  async function enhanceDiagrams(current: HtmlContentValue) {
    const generation = ++mermaidGeneration;
    for (const [host, destroy] of diagrams) {
      if (node.contains(host)) continue;
      destroy();
      diagrams.delete(host);
    }
    const hosts = [
      ...node.querySelectorAll<HTMLElement>("[data-mermaid-diagram]"),
    ];
    if (hosts.every((host) => diagrams.has(host))) return;
    // Let the surrounding layout settle so the scroll root can be resolved.
    await tick();
    if (generation !== mermaidGeneration) return;
    const blocks = extractMermaidMarkdownBlocks(
      current.source,
      current.sourceLineStart,
    );
    for (const [index, host] of hosts.entries()) {
      if (diagrams.has(host) || !node.contains(host)) continue;
      diagrams.set(
        host,
        enhanceMermaidHost(node, host, blocks[index], current.onOpenMermaid),
      );
    }
  }

  function apply(next: HtmlContentValue, previous?: HtmlContentValue) {
    if (
      previous &&
      (next.sourceLineStart !== previous.sourceLineStart ||
        next.onOpenMermaid !== previous.onOpenMermaid)
    ) {
      // Diagram callbacks capture these; rebuild them all.
      clearDiagrams();
      nodes = [];
      signatures = [];
      node.replaceChildren();
    }
    reconcile(next.html);
    enhanceCopyButtons();
    void enhanceDiagrams(next);
  }

  apply(value);
  node.addEventListener("click", handleClick);
  return {
    update(next: HtmlContentValue) {
      if (
        next.html === value.html &&
        next.source === value.source &&
        next.sourceLineStart === value.sourceLineStart &&
        next.onOpenMermaid === value.onOpenMermaid
      ) {
        return;
      }
      const previous = value;
      value = next;
      apply(next, previous);
    },
    destroy() {
      mermaidGeneration += 1;
      node.removeEventListener("click", handleClick);
      for (const button of copyButtons.values()) void unmount(button);
      copyButtons.clear();
      clearDiagrams();
    },
  };
}

function commitStreaming(value: StreamingValue) {
  const parts = splitForDisplay(value.source);
  if (
    parts.prefix !== streamingPrefixSource ||
    value.trim !== streamingPrefixTrim ||
    value.preserveLineBreaks !== streamingPrefixPreserveLineBreaks
  ) {
    streamingPrefixHtml = renderStreamingPrefix(
      parts.prefix,
      value.trim,
      value.preserveLineBreaks,
    );
    streamingPrefixSource = parts.prefix;
    streamingPrefixTrim = value.trim;
    streamingPrefixPreserveLineBreaks = value.preserveLineBreaks;
  }
  streamingTail = parts.tail;
  showingStreaming = true;
  highlightToken += 1;
}

const streamingScheduler = new LatestPresentationScheduler<StreamingValue>(
  commitStreaming,
);

// Paced reveal: the pacer decides how much of the latest streaming source is
// visible each frame. Text already present at mount is never replayed.
let revealTarget: StreamingValue | undefined;
let revealedLength = untrack(() => text.length);
/** Final (non-streaming) render deferred until the reveal drains. */
let revealFinal: StreamingValue | undefined;
// Fades freshly revealed tail text. Text visible at mount is settled.
const fadeTracker = new StreamingFadeTracker({
  initialText: untrack(() => text),
});
let finishTimer: ReturnType<typeof setTimeout> | undefined;
const revealLoop = new StreamingRevealLoop(
  untrack(() => text.length),
  {
    onReveal(shown) {
      const value = revealTarget;
      if (!value) return;
      const length = revealBoundary(value.source, shown);
      if (length !== revealedLength) showRevealed(value, length);
    },
    onSettled() {
      if (revealFinal) finishRevealAfterFade(revealFinal);
    },
  },
);

const revealing = $derived(reveal && !prefersReducedMotion.current);

function showRevealed(value: StreamingValue, length: number) {
  const revealed = value.source.slice(0, length);
  fadeTracker.update(revealed, performance.now());
  const appended = revealed.slice(Math.min(revealedLength, revealed.length));
  const tailOnly =
    length >= revealedLength &&
    !appended.includes("\n") &&
    value.trim === streamingPrefixTrim &&
    value.preserveLineBreaks === streamingPrefixPreserveLineBreaks &&
    revealed.startsWith(streamingPrefixSource) &&
    showingStreaming;
  revealedLength = length;
  if (tailOnly) {
    // Hot path: only the escaped plain-text tail grows between newlines.
    streamingTail = revealed.slice(streamingPrefixSource.length);
    return;
  }
  commitStreaming({ ...value, source: revealed });
}

function clearFinishTimer() {
  if (finishTimer === undefined) return;
  clearTimeout(finishTimer);
  finishTimer = undefined;
}

/** Swap to the final render only once the youngest fading chunk is opaque. */
function finishRevealAfterFade(value: StreamingValue) {
  clearFinishTimer();
  const remaining = (fadeTracker.settlesAt ?? 0) - performance.now();
  if (remaining <= 0) {
    finishReveal(value);
    return;
  }
  revealFinal = value;
  finishTimer = setTimeout(() => {
    finishTimer = undefined;
    finishReveal(value);
  }, remaining);
}

function finishReveal(value: StreamingValue) {
  clearFinishTimer();
  fadeTracker.settle();
  revealFinal = undefined;
  showingStreaming = false;
  revealedLength = value.source.length;
  renderWithHighlight(value.source, value.trim, value.preserveLineBreaks);
}

function stopReveal() {
  clearFinishTimer();
  revealLoop.stop();
  revealTarget = undefined;
  revealFinal = undefined;
}

/** Full render + async Shiki highlight. Used only for finalized content. */
function renderWithHighlight(
  source: string,
  trim: boolean,
  preserveBreaks: boolean,
) {
  const cachedHighlighted = getHighlightedMarkdownSync(
    source,
    trim,
    preserveBreaks,
  );
  if (cachedHighlighted !== undefined) {
    html = cachedHighlighted;
    highlightToken += 1;
    return;
  }
  html = renderDecoratedMarkdown(source, trim, preserveBreaks);
  const token = (highlightToken += 1);
  renderHighlightedMarkdown(source, trim, preserveBreaks)
    .then((highlighted) => {
      if (token === highlightToken) {
        html = highlighted;
      }
    })
    .catch(() => {
      if (token === highlightToken) {
        html = renderDecoratedMarkdown(source, trim, preserveBreaks);
      }
    });
}

$effect(() => {
  const source = text;
  const trim = trimCodeBlocks;
  const preserveBreaks = preserveLineBreaks;
  const paced = revealing;
  const value = { source, trim, preserveLineBreaks: preserveBreaks };
  const wasStreaming = untrack(() => showingStreaming);
  if (paced && (streaming || wasStreaming)) {
    clearFinishTimer();
    revealTarget = value;
    lastEnqueuedSource = source;
    lastEnqueuedTrim = trim;
    lastEnqueuedPreserveLineBreaks = preserveBreaks;
    if (!wasStreaming) {
      // First streaming frame renders whatever is already revealed.
      untrack(() =>
        showRevealed(value, revealBoundary(source, revealLoop.shownLength)),
      );
    }
    // Set the deferred final render before the target: a loop without a
    // frame source settles synchronously and must see the current intent.
    revealFinal = streaming ? undefined : value;
    untrack(() => revealLoop.setTarget(source.length, { done: !streaming }));
    if (streaming) return;
    // The source completed: drain the backlog, then render the final form.
    if (!revealLoop.settled) return;
    revealLoop.stop();
    revealTarget = undefined;
    untrack(() => finishRevealAfterFade(value));
    return;
  }
  if (revealTarget) stopReveal();
  fadeTracker.update(source, 0);
  fadeTracker.settle();
  untrack(() => revealLoop.snap(source.length));
  revealedLength = source.length;
  if (!streaming) {
    if (showingStreaming) {
      streamingScheduler.flushNow({
        source,
        trim,
        preserveLineBreaks: preserveBreaks,
      });
    }
    showingStreaming = false;
    renderWithHighlight(source, trim, preserveBreaks);
    lastEnqueuedSource = source;
    lastEnqueuedTrim = trim;
    lastEnqueuedPreserveLineBreaks = preserveBreaks;
    return;
  }

  const priority =
    !showingStreaming ||
    trim !== lastEnqueuedTrim ||
    preserveBreaks !== lastEnqueuedPreserveLineBreaks ||
    appendedNewline(lastEnqueuedSource, source);
  lastEnqueuedSource = source;
  lastEnqueuedTrim = trim;
  lastEnqueuedPreserveLineBreaks = preserveBreaks;
  streamingScheduler.enqueue(
    { source, trim, preserveLineBreaks: preserveBreaks },
    { priority },
  );
});

$effect(() => () => {
  streamingScheduler.destroy();
  stopReveal();
  revealLoop.destroy();
});
</script>

<div class="markdown select-text">
  <!-- The rendered (sanitized) Markdown; the streaming tail follows it. -->
  <div
    class="markdown-rendered contents"
    use:htmlContent={showingStreaming
      ? {
          html: streamingPrefixHtml,
          source: streamingPrefixSource,
          sourceLineStart,
          onOpenMermaid,
        }
      : { html, source: text, sourceLineStart, onOpenMermaid }}
  ></div>
  {#if showingStreaming}
    {#if revealing}
      <StreamingTail
        source={streamingPrefixSource + streamingTail}
        from={streamingPrefixSource.length}
        tracker={fadeTracker}
        {preserveLineBreaks}
        {caret}
      />
    {:else}
      {#if streamingTail}
        <span class="whitespace-pre-wrap break-words">{streamingTail}</span>
      {/if}
      {#if caret}
        <span
          class="stream-caret ml-[0.3em] inline-block size-[0.42em] rounded-full bg-primary align-[0.1em]"
          aria-hidden="true"
        ></span>
      {/if}
    {/if}
  {/if}
</div>

<style>
.stream-caret {
  animation: stream-caret-breathe 1.1s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .stream-caret {
    animation: none;
    opacity: 0.7;
  }
}

.markdown {
  min-width: 0;
  max-width: 100%;
  color: color-mix(in oklab, var(--foreground) 92%, transparent);
  font-size: var(--text-sm);
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.markdown :global(:first-child) {
  margin-top: 0;
}

.markdown :global(:last-child) {
  margin-bottom: 0;
}

/* The rendered wrapper is display: contents and always the first child; with
   nothing rendered yet, the streaming tail's first block starts the content. */
.markdown-rendered:empty + :global(*) {
  margin-top: 0;
}

.markdown :global(p),
.markdown :global(ul),
.markdown :global(ol),
.markdown :global(blockquote),
.markdown :global(pre),
.markdown :global(.table-scroll),
.markdown :global(.code-block),
.markdown :global(.mermaid-block) {
  margin: calc(var(--spacing) * 1.5) 0;
}

.markdown :global(ul),
.markdown :global(ol) {
  padding-left: 1.35rem;
}

.markdown :global(ul) {
  list-style: disc;
}

.markdown :global(ul ul) {
  list-style: circle;
}

.markdown :global(ul ul ul) {
  list-style: square;
}

.markdown :global(ol) {
  list-style: decimal;
}

.markdown :global(ol ol) {
  list-style: lower-alpha;
}

.markdown :global(ol ol ol) {
  list-style: lower-roman;
}

.markdown :global(li) {
  margin: 0.2rem 0;
  padding-left: 0.15rem;
}

.markdown :global(li > p) {
  margin: 0.25rem 0;
}

.markdown :global(li > ul),
.markdown :global(li > ol) {
  margin: 0.25rem 0;
}

.markdown :global(.contains-task-list) {
  list-style: none;
  padding-left: 0.2rem;
}

.markdown :global(.task-list-item) {
  padding-left: calc(var(--spacing) * 5);
}

.markdown :global(.task-list-item > input[type="checkbox"]) {
  width: calc(var(--spacing) * 3.5);
  height: calc(var(--spacing) * 3.5);
  margin: 0 calc(var(--spacing) * 0.5) 0 calc(var(--spacing) * -5);
  vertical-align: -0.125em;
  accent-color: var(--primary);
}

.markdown :global(h1),
.markdown :global(h2),
.markdown :global(h3),
.markdown :global(h4),
.markdown :global(h5),
.markdown :global(h6) {
  margin: calc(var(--spacing) * 6) 0 calc(var(--spacing) * 1);
  color: var(--foreground);
  font-weight: 600;
  line-height: 1.25;
}

.markdown :global(h1),
.markdown :global(h2),
.markdown :global(h3),
.markdown :global(h4),
.markdown :global(h5),
.markdown :global(h6) {
  font-size: var(--text-sm);
}

.markdown :global(a) {
  color: var(--primary);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--primary) 50%, transparent);
  text-underline-offset: 0.18em;
}

.markdown :global(img) {
  display: inline-block;
  max-width: 100%;
  height: auto;
  vertical-align: middle;
}

.markdown :global(code) {
  display: inline;
  border-radius: 0.25rem;
  background: color-mix(in oklab, currentColor 14%, transparent);
  color: inherit;
  padding: 0.05rem 0.3rem;
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.markdown :global(.code-block) {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--well);
}

.markdown :global(.code-copy) {
  position: absolute;
  top: calc(var(--spacing) * 1);
  right: calc(var(--spacing) * 1);
  z-index: 1;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.markdown :global(.code-block:hover .code-copy),
.markdown :global(.code-copy:focus-within) {
  opacity: 1;
}

@media (hover: none) {
  .markdown :global(.code-copy) {
    opacity: 1;
  }
}

.markdown :global(.mermaid-block) {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--card);
}

.markdown :global(pre) {
  overflow: visible;
  border: 0;
  border-radius: 0;
  background: var(--well) !important;
  margin: 0;
  padding: 0.55rem 0.6rem;
  font-size: var(--text-xs);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.markdown :global(pre code) {
  display: block;
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
  font-size: inherit;
  white-space: inherit;
  word-break: inherit;
}

.markdown :global(blockquote) {
  border-left: 2px solid var(--primary);
  padding-left: 0.85rem;
  color: var(--muted-foreground);
}

.markdown :global(.table-scroll) {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid color-mix(in oklab, var(--border) 70%, transparent);
  border-radius: calc(var(--radius) - 0.25rem);
  background: color-mix(in oklab, var(--card) 60%, transparent);
}

.markdown :global(table) {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  table-layout: auto;
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--text-xs);
  line-height: var(--tw-leading, var(--text-xs--line-height));
}

.markdown :global(th),
.markdown :global(td) {
  border-bottom: 1px solid color-mix(in oklab, var(--border) 50%, transparent);
  border-left: 1px solid color-mix(in oklab, var(--border) 50%, transparent);
  padding: calc(var(--spacing) * 2) calc(var(--spacing) * 2.5);
  text-align: left;
  vertical-align: top;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.markdown :global(tbody tr:last-child th),
.markdown :global(tbody tr:last-child td) {
  border-bottom: none;
}

.markdown :global(th:first-child),
.markdown :global(td:first-child) {
  border-left: none;
}

.markdown :global(tbody tr:nth-child(odd)) {
  background: color-mix(in oklab, var(--muted) 35%, transparent);
}

.markdown :global(tbody tr:hover) {
  background: color-mix(in oklab, var(--accent) 45%, transparent);
}

.markdown :global(th) {
  position: sticky;
  top: 0;
  z-index: 1;
  background: color-mix(in oklab, var(--card) 92%, var(--muted));
  color: var(--muted-foreground);
  font-weight: var(--font-weight-medium);
  border-bottom-color: color-mix(in oklab, var(--border) 80%, transparent);
}
</style>
