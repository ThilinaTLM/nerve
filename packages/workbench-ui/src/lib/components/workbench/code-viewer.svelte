<script lang="ts">
import { highlightCodeCached } from "@nervekit/ui-kit/core/highlight/highlight";

type Props = {
  /** Raw text to render. */
  text: string;
  /** Highlight language id (see `extname`/`normalizeHighlightLanguage`). */
  language?: string;
  /** 1-based number of the first rendered line. */
  lineStart?: number;
  /** 1-based line to emphasize (and expose via `data-file-line`). */
  targetLine?: number;
  /** Soft-wrap long lines instead of scrolling horizontally. */
  wrap?: boolean;
  class?: string;
};

let {
  text,
  language,
  lineStart = 1,
  targetLine,
  wrap = false,
  class: className = "",
}: Props = $props();

let html = $state<string | undefined>(undefined);
let htmlSignature = $state<string | undefined>(undefined);
let unavailableSignature = $state<string | undefined>(undefined);

const textLines = $derived(text.split("\n"));
const lastLineNumber = $derived(lineStart + Math.max(0, textLines.length - 1));
const lineNumberWidth = $derived(
  `${Math.max(2, String(lastLineNumber).length)}ch`,
);
const codeViewStyle = $derived(
  `--line-number-width: ${lineNumberWidth}; counter-reset: code-line ${lineStart - 1};`,
);
const codeSignature = $derived(`${language ?? ""}\0${text}`);
const annotatedCodeSignature = $derived(
  `${codeSignature}\0${lineStart}\0${targetLine ?? ""}`,
);
const showHtml = $derived(
  html !== undefined && htmlSignature === annotatedCodeSignature,
);

function annotateHighlightedLines(
  highlighted: string,
  startLine: number,
  selectedLine: number | undefined,
): string {
  let index = 0;
  return highlighted
    .replaceAll(
      /<\/span>\r?\n<span class="line">/g,
      '</span><span class="line">',
    )
    .replaceAll(/<span class="line"/g, () => {
      const line = startLine + index;
      index += 1;
      const classes = line === selectedLine ? "line file-target-line" : "line";
      return `<span class="${classes}" data-file-line="${line}"`;
    });
}

$effect(() => {
  const currentSignature = annotatedCodeSignature;
  if (
    htmlSignature === currentSignature ||
    unavailableSignature === currentSignature
  )
    return;

  const result = highlightCodeCached(text, language);
  if (typeof result === "string") {
    html = annotateHighlightedLines(result, lineStart, targetLine);
    htmlSignature = currentSignature;
    unavailableSignature = undefined;
    return;
  }
  if (!result) {
    unavailableSignature = currentSignature;
    return;
  }

  let cancelled = false;
  void result.then((highlighted) => {
    if (cancelled || annotatedCodeSignature !== currentSignature) return;
    if (highlighted) {
      html = annotateHighlightedLines(highlighted, lineStart, targetLine);
      htmlSignature = currentSignature;
      unavailableSignature = undefined;
    } else {
      unavailableSignature = currentSignature;
    }
  });
  return () => {
    cancelled = true;
  };
});
</script>

{#if showHtml}
  <div
    class={`code-view ${className}`}
    class:wrap-lines={wrap}
    style={codeViewStyle}
  >
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- Shiki serializes source code into controlled highlighted markup. -->
    {@html html}
  </div>
{:else}
  <pre
    class={`code-view plain ${className}`}
    class:wrap-lines={wrap}
    style={codeViewStyle}><code
      >{#each textLines as line, index (index)}{@const lineNumber =
          lineStart + index}<span
          class={lineNumber === targetLine
            ? "code-line file-target-line"
            : "code-line"}
          data-file-line={lineNumber}>{line}</span
        >{/each}</code
    ></pre>
{/if}

<style>
.code-view {
  --file-code-font-size: var(--text-sm);
  --line-number-width: 2ch;
  --line-number-gap: calc(var(--spacing) * 6);
  counter-reset: code-line;
  min-width: 100%;
  margin: 0;
  overflow: visible;
  color: var(--foreground);
  font-family: var(--font-mono);
  font-size: var(--file-code-font-size);
  line-height: 1.5;
  tab-size: 2;
}

.code-view:not(.wrap-lines) {
  width: max-content;
}

.code-view.wrap-lines {
  width: 100%;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.code-view.plain {
  white-space: pre;
}

.code-view.plain.wrap-lines {
  white-space: pre-wrap;
}

.code-view :global(pre) {
  margin: 0;
  overflow: visible;
  background: transparent !important;
  white-space: pre;
}

.code-view.wrap-lines :global(pre) {
  white-space: pre-wrap;
}

.code-view :global(code),
.code-view code {
  font-family: var(--font-mono);
  font-size: var(--file-code-font-size);
  white-space: inherit;
}

.code-view :global(.line),
.code-line {
  display: block;
  min-height: 1.5em;
  padding-right: 1rem;
}

.code-view.wrap-lines :global(.line),
.code-view.wrap-lines .code-line {
  padding-left: calc(var(--line-number-width) + var(--line-number-gap));
  overflow-wrap: anywhere;
  text-indent: calc(-1 * (var(--line-number-width) + var(--line-number-gap)));
  white-space: pre-wrap;
}

.code-view :global(.line)::before,
.code-line::before {
  counter-increment: code-line;
  content: counter(code-line);
  position: sticky;
  left: 0;
  display: inline-block;
  width: var(--line-number-width);
  margin-right: var(--line-number-gap);
  background: var(--background);
  color: color-mix(in oklab, var(--muted-foreground) 58%, transparent);
  text-align: right;
  user-select: none;
}

.code-view :global(.file-target-line),
.code-line.file-target-line {
  border-radius: calc(var(--radius-sm) * 0.75);
  background: color-mix(in oklab, var(--warning) 18%, transparent);
  box-shadow: inset 0.2rem 0 0
    color-mix(in oklab, var(--warning) 72%, transparent);
}

.code-view :global(.file-target-line)::before,
.code-line.file-target-line::before {
  background: color-mix(in oklab, var(--warning) 18%, var(--background));
  color: var(--foreground);
}

.code-view :global(span) {
  color: var(--shiki-light, inherit);
}

:global(.dark) .code-view :global(span) {
  color: var(--shiki-dark, inherit);
}
</style>
