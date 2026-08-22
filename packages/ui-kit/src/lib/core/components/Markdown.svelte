<script lang="ts">
import { mount, tick, unmount, untrack } from "svelte";
import { writeClipboardText } from "@nervekit/ui-kit/core/clipboard";
import {
  decorateMarkdownHtml,
  getHighlightedMarkdownSync,
  renderBestAvailableMarkdown,
  renderDecoratedMarkdown,
  renderHighlightedMarkdown,
  renderMarkdown,
} from "@nervekit/ui-kit/core/components/markdown-render";
import {
  extractMermaidMarkdownBlocks,
  type MermaidMarkdownBlock,
} from "@nervekit/ui-kit/core/components/mermaid-blocks";
import {
  appendedNewline,
  splitStreamingMarkdown,
} from "@nervekit/ui-kit/core/components/streaming-markdown";
import { LatestPresentationScheduler } from "@nervekit/ui-kit/core/utils/latest-presentation-scheduler";
import {
  parseLocalFileHref,
  resolveDisplayPath,
  splitPathLineSuffix,
} from "@nervekit/ui-kit/core/utils/path-links";
import { observeMermaidVisibility } from "./mermaid-visibility.js";
import MermaidDiagram from "./MermaidDiagram.svelte";

type Props = {
  text: string;
  trimCodeBlocks?: boolean;
  /** Convert Markdown soft line endings into semantic hard breaks. */
  preserveLineBreaks?: boolean;
  /** Bound streaming work while deferring Shiki until completion. */
  streaming?: boolean;
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

const initialRender = untrack(() => {
  const parts = streaming ? splitStreamingMarkdown(text) : undefined;
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
  const button = target.closest<HTMLButtonElement>("button[data-copy-code]");
  if (button) {
    const code =
      button.closest(".code-block")?.querySelector("pre code")?.textContent ??
      "";
    if (!code) return;
    try {
      await writeClipboardText(code);
      onCopy?.(true);
    } catch {
      onCopy?.(false);
    }
    return;
  }

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

function copyButtonHandler(node: HTMLDivElement) {
  node.addEventListener("click", handleClick);
  return {
    destroy() {
      node.removeEventListener("click", handleClick);
    },
  };
}

type MermaidEnhancement = {
  destroy: () => void;
  matches: (root: HTMLElement, value: MermaidHandlerValue) => boolean;
};
type MermaidHandlerValue = {
  html: string;
  source: string;
  sourceLineStart: number;
  onOpenMermaid?: (block: MermaidMarkdownBlock) => void;
};

type MermaidHostValue = {
  host: HTMLElement;
  source: string;
  ariaLabel: string;
  extracted?: MermaidMarkdownBlock;
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

function enhanceMermaidBlocks(
  root: HTMLElement,
  value: MermaidHandlerValue,
): MermaidEnhancement {
  const components: Record<string, unknown>[] = [];
  const blocks = extractMermaidMarkdownBlocks(
    value.source,
    value.sourceLineStart,
  );
  const hosts = [
    ...root.querySelectorAll<HTMLElement>("[data-mermaid-diagram]"),
  ];
  const hostValues: MermaidHostValue[] = [];
  let active = true;

  for (const [index, host] of hosts.entries()) {
    const extracted = blocks[index];
    const source =
      extracted?.source ?? host.querySelector("pre > code")?.textContent ?? "";
    if (!source.trim()) continue;
    hostValues.push({
      host,
      source,
      extracted,
      ariaLabel: host.getAttribute("aria-label") ?? "Mermaid diagram",
    });
    createMermaidPlaceholder(host);
  }

  const stopObserving = observeMermaidVisibility(
    hostValues.map((value) => value.host),
    {
      root: nearestVerticalScrollRoot(root),
      mount: (target) => {
        const host = target as HTMLElement;
        const hostValue = hostValues.find((value) => value.host === host);
        if (!active || !host.isConnected || !hostValue) return;
        host.removeAttribute("aria-busy");
        host.replaceChildren();
        components.push(
          mount(MermaidDiagram, {
            target: host,
            props: {
              source: hostValue.source,
              ariaLabel: hostValue.ariaLabel,
              class: "h-full w-full",
              onOpenStandalone:
                hostValue.extracted && value.onOpenMermaid
                  ? () => value.onOpenMermaid?.(hostValue.extracted!)
                  : undefined,
            },
          }),
        );
      },
    },
  );

  return {
    matches(nextRoot, nextValue) {
      if (
        nextValue.source !== value.source ||
        nextValue.sourceLineStart !== value.sourceLineStart ||
        nextValue.onOpenMermaid !== value.onOpenMermaid
      )
        return false;
      const nextHosts = nextRoot.querySelectorAll("[data-mermaid-diagram]");
      return (
        nextHosts.length === hosts.length &&
        hosts.every((host, index) => nextHosts[index] === host)
      );
    },
    destroy() {
      active = false;
      stopObserving();
      for (const component of components) void unmount(component);
    },
  };
}

function mermaidHandler(node: HTMLDivElement, value: MermaidHandlerValue) {
  let generation = 0;
  let enhancement: MermaidEnhancement | undefined;

  async function update(nextValue: MermaidHandlerValue) {
    const current = ++generation;
    if (!nextValue.html.includes("data-mermaid-diagram")) {
      enhancement?.destroy();
      enhancement = undefined;
      return;
    }
    await tick();
    if (current !== generation || enhancement?.matches(node, nextValue)) return;
    enhancement?.destroy();
    enhancement = enhanceMermaidBlocks(node, nextValue);
  }

  void update(value);
  return {
    update,
    destroy() {
      generation += 1;
      enhancement?.destroy();
    },
  };
}

function commitStreaming(value: StreamingValue) {
  const parts = splitStreamingMarkdown(value.source);
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

$effect(() => () => streamingScheduler.destroy());
</script>

{#if showingStreaming}
  <div
    class="markdown select-text"
    use:copyButtonHandler
    use:mermaidHandler={{
      html: streamingPrefixHtml,
      source: streamingPrefixSource,
      sourceLineStart,
      onOpenMermaid,
    }}
  >
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- the prefix uses the sanitized Markdown pipeline. -->
    {@html streamingPrefixHtml}
    {#if streamingTail}
      <span class="whitespace-pre-wrap break-words">{streamingTail}</span>
    {/if}
  </div>
{:else}
  <div
    class="markdown select-text"
    use:copyButtonHandler
    use:mermaidHandler={{ html, source: text, sourceLineStart, onOpenMermaid }}
  >
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown applies rehype-sanitize before producing markup. -->
    {@html html}
  </div>
{/if}
<style>
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
  background: var(--sidebar);
}

.markdown :global(.code-copy) {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  z-index: 1;
  opacity: 0;
  border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
  border-radius: 0.25rem;
  background: var(--input);
  color: var(--muted-foreground);
  padding: 0.12rem 0.38rem;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: opacity 0.12s ease;
}

.markdown :global(.code-block:hover .code-copy),
.markdown :global(.code-copy:focus-visible) {
  opacity: 1;
}

.markdown :global(.code-copy:hover) {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--primary);
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
  background: var(--sidebar) !important;
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

.markdown :global(.code-block span) {
  color: var(--shiki-light, inherit);
}

:global(.dark) .markdown :global(.code-block span) {
  color: var(--shiki-dark, inherit);
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
  table-layout: fixed;
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
