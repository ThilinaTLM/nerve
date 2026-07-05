<script lang="ts">
  import { tick } from "svelte";
  import FileText from "@lucide/svelte/icons/file-text";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Markdown from "@nervekit/ui/core/components/Markdown.svelte";
  import { notifyCopyResult } from "$lib/features/notifications/notify.svelte";
  import { highlightCodeCached } from "$lib/core/highlight/highlight";
  import type { FileViewState } from "$lib/core/types/state-types";
  import { extname } from "@nervekit/conversation-ui/tools/views/lang";
  import { defaultFileDisplayMode, isMarkdownPath } from "$lib/core/utils/file-display";
  import { ScrollArea } from "@nervekit/ui/components/ui/scroll-area";

  type Props = {
    view?: FileViewState;
  };

  let { view }: Props = $props();

  let html = $state<string | undefined>(undefined);
  let htmlSignature = $state<string | undefined>(undefined);
  let unavailableSignature = $state<string | undefined>(undefined);
  let viewportRef = $state<HTMLElement | null>(null);
  let scrolledSignature = $state<string | undefined>(undefined);
  const file = $derived(view?.content);
  const filePath = $derived(file?.relativePath ?? view?.path);
  const markdown = $derived(isMarkdownPath(filePath));
  const lineStart = $derived(file?.lineStart ?? 1);
  const targetLine = $derived(view?.line ?? file?.targetLine);
  const displayMode = $derived(
    view?.displayMode ?? (targetLine ? "raw" : defaultFileDisplayMode(filePath)),
  );
  const language = $derived(extname(filePath));
  const codeSignature = $derived(
    file?.type === "text" && file.text !== undefined && displayMode === "raw"
      ? `${language ?? ""}\0${file.text}`
      : undefined,
  );
  const annotatedCodeSignature = $derived(
    codeSignature ? `${codeSignature}\0${lineStart}\0${targetLine ?? ""}` : undefined,
  );
  const imageSrc = $derived(
    file?.type === "image" && file.dataBase64 && file.mimeType
      ? `data:${file.mimeType};base64,${file.dataBase64}`
      : undefined,
  );
  const textLines = $derived(
    file?.type === "text" && file.text !== undefined ? file.text.split("\n") : [],
  );
  const lastLineNumber = $derived(lineStart + Math.max(0, textLines.length - 1));
  const lineNumberWidth = $derived(`${Math.max(2, String(lastLineNumber).length)}ch`);
  const codeViewStyle = $derived(`--line-number-width: ${lineNumberWidth}; counter-reset: code-line ${lineStart - 1};`);

  function annotateHighlightedLines(
    highlighted: string,
    startLine: number,
    selectedLine: number | undefined,
  ): string {
    let index = 0;
    return highlighted
      .replaceAll(/<\/span>\r?\n<span class="line">/g, "</span><span class=\"line\">")
      .replaceAll(/<span class="line"/g, () => {
        const line = startLine + index;
        index += 1;
        const classes = line === selectedLine ? "line file-target-line" : "line";
        return `<span class="${classes}" data-file-line="${line}"`;
      });
  }

  $effect(() => {
    if (file?.type !== "text" || file.text === undefined || !codeSignature) return;
    const currentSignature = annotatedCodeSignature;
    if (!currentSignature) return;
    if (htmlSignature === currentSignature || unavailableSignature === currentSignature) return;

    const result = highlightCodeCached(file.text, language);
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

  $effect(() => {
    if (!viewportRef || file?.type !== "text" || !targetLine) return;
    const signature = `${file.path}:${lineStart}:${targetLine}:${displayMode}:${htmlSignature ?? codeSignature ?? textLines.length}`;
    if (scrolledSignature === signature) return;

    void tick().then(() => {
      const target = viewportRef?.querySelector<HTMLElement>(`[data-file-line="${targetLine}"]`);
      if (!target) return;
      target.scrollIntoView({ block: "center", inline: "nearest" });
      scrolledSignature = signature;
    });
  });
</script>

<section class="file-pane">
  <ScrollArea bind:viewportRef class="file-scroll" viewportClass="file-viewport" type="auto" orientation="both">
    {#if !view}
      <div class="file-empty">
        <FileText size={28} strokeWidth={1.7} />
        <strong>No file selected</strong>
        <p>Open a file from a tool result to view it here.</p>
      </div>
    {:else if view.loading && !file}
      <div class="file-empty">
        <RefreshCw class="spin" size={28} strokeWidth={1.7} />
        <strong>Loading file</strong>
        <p>{view.path}</p>
      </div>
    {:else if view.error}
      <div class="file-empty danger">
        <TriangleAlert size={28} strokeWidth={1.7} />
        <strong>Could not open file</strong>
        <p>{view.error}</p>
      </div>
    {:else if imageSrc}
      <div class="image-wrap">
        <img src={imageSrc} alt={file?.relativePath ?? "File preview"} />
      </div>
    {:else if file?.type === "text"}
      {#if markdown && displayMode === "rendered"}
        <div class="markdown-view">
          <Markdown text={file.text ?? ""} trimCodeBlocks={false} onCopy={notifyCopyResult} />
        </div>
      {:else if html && htmlSignature === annotatedCodeSignature}
        <div class="code-view" class:wrap-lines={view?.wrapLines} style={codeViewStyle}>{@html html}</div>
      {:else}
        <pre class="code-view plain" class:wrap-lines={view?.wrapLines} style={codeViewStyle}><code>{#each textLines as line, index}{@const lineNumber = lineStart + index}<span class={lineNumber === targetLine ? "code-line file-target-line" : "code-line"} data-file-line={lineNumber}>{line}</span>{/each}</code></pre>
      {/if}
    {:else}
      <div class="file-empty">
        <FileText size={28} strokeWidth={1.7} />
        <strong>Binary preview unavailable</strong>
        <p>This file can be opened as metadata only for now.</p>
      </div>
    {/if}
  </ScrollArea>
</section>

<style>
  .file-pane {
    display: grid;
    height: 100%;
    min-width: 0;
    min-height: 0;
    background: var(--background);
  }

  :global(.file-scroll) {
    min-width: 0;
    min-height: 0;
  }

  :global(.file-viewport) {
    padding: 1rem;
  }

  .file-empty {
    display: grid;
    min-height: 18rem;
    place-items: center;
    align-content: center;
    gap: 0.35rem;
    color: var(--muted-foreground);
    text-align: center;
  }

  .file-empty :global(svg) {
    color: var(--primary);
  }

  .file-empty.danger :global(svg) {
    color: var(--destructive);
  }

  .file-empty strong {
    color: var(--foreground);
  }

  .file-empty p {
    max-width: 34rem;
    margin: 0;
    font-size: var(--text-sm);
  }

  .image-wrap {
    display: grid;
    min-height: 100%;
    place-items: center;
  }

  .image-wrap img {
    max-width: 100%;
    max-height: calc(100vh - 7rem);
    object-fit: contain;
  }

  .markdown-view {
    max-width: min(100%, 72rem);
    padding: 0.15rem 0.2rem 4rem;
  }

  .markdown-view :global(.markdown) {
    font-size: var(--text-base);
    line-height: 1.62;
  }

  .code-view {
    --file-code-font-size: var(--text-sm);
    --line-number-width: 2ch;
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
    padding-left: calc(var(--line-number-width) + 1rem);
    overflow-wrap: anywhere;
    text-indent: calc(-1 * (var(--line-number-width) + 1rem));
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
    margin-right: 1rem;
    background: var(--background);
    color: color-mix(in oklab, var(--muted-foreground) 58%, transparent);
    text-align: right;
    user-select: none;
  }

  .code-view :global(.file-target-line),
  .code-line.file-target-line {
    border-radius: calc(var(--radius-sm) * 0.75);
    background: color-mix(in oklab, var(--warning) 18%, transparent);
    box-shadow: inset 0.2rem 0 0 color-mix(in oklab, var(--warning) 72%, transparent);
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
