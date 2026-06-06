<script lang="ts">
  import FileText from "@lucide/svelte/icons/file-text";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { highlightCodeCached } from "../../highlight";
  import type { FileViewState } from "../../stores/workbench/state.svelte";
  import { extname } from "../../tool-views/lang";
  import { ScrollArea } from "$lib/components/ui/scroll-area";

  type Props = {
    view?: FileViewState;
  };

  let { view }: Props = $props();

  let html = $state<string | undefined>(undefined);
  let htmlSignature = $state<string | undefined>(undefined);
  let unavailableSignature = $state<string | undefined>(undefined);
  const file = $derived(view?.content);
  const language = $derived(extname(file?.relativePath ?? view?.path));
  const codeSignature = $derived(
    file?.type === "text" && file.text !== undefined
      ? `${language ?? ""}\0${file.text}`
      : undefined,
  );
  const imageSrc = $derived(
    file?.type === "image" && file.dataBase64 && file.mimeType
      ? `data:${file.mimeType};base64,${file.dataBase64}`
      : undefined,
  );
  const textLines = $derived(
    file?.type === "text" && file.text !== undefined ? file.text.split("\n") : [],
  );
  const lineNumberWidth = $derived(`${Math.max(2, String(textLines.length || 1).length)}ch`);

  function withCompactHighlightedLines(highlighted: string): string {
    return highlighted.replaceAll(/<\/span>\r?\n<span class="line">/g, "</span><span class=\"line\">");
  }

  $effect(() => {
    if (file?.type !== "text" || file.text === undefined || !codeSignature) return;
    const currentSignature = codeSignature;
    if (htmlSignature === currentSignature || unavailableSignature === currentSignature) return;

    const result = highlightCodeCached(file.text, language);
    if (typeof result === "string") {
      html = withCompactHighlightedLines(result);
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
      if (cancelled || codeSignature !== currentSignature) return;
      if (highlighted) {
        html = withCompactHighlightedLines(highlighted);
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

<section class="file-pane">
  <ScrollArea class="file-scroll" viewportClass="file-viewport" type="auto">
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
      {#if html && htmlSignature === codeSignature}
        <div class="code-view" style={`--line-number-width: ${lineNumberWidth};`}>{@html html}</div>
      {:else}
        <pre class="code-view plain" style={`--line-number-width: ${lineNumberWidth};`}><code>{#each textLines as line}<span class="code-line">{line}</span>{/each}</code></pre>
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
    min-height: 0;
    background: var(--background);
  }

  :global(.file-scroll) {
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

  .code-view {
    --line-number-width: 2ch;
    counter-reset: code-line;
    margin: 0;
    overflow: auto;
    color: var(--foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    tab-size: 2;
  }

  .code-view.plain {
    white-space: pre;
  }

  .code-view :global(pre) {
    margin: 0;
    overflow: visible;
    background: transparent !important;
    white-space: pre;
  }

  .code-view :global(code),
  .code-view code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .code-view :global(.line),
  .code-line {
    display: block;
    min-height: 1.5em;
    padding-right: 1rem;
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

  .code-view :global(span) {
    color: var(--shiki-light, inherit);
  }

  :global(.dark) .code-view :global(span) {
    color: var(--shiki-dark, inherit);
  }

  :global(.spin) {
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
