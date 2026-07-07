<script lang="ts">
  import { tick } from "svelte";
  import { FileText, RefreshCw, TriangleAlert } from "@lucide/svelte";
  import { ScrollArea } from "@nervekit/ui/components/ui/scroll-area";
  import Markdown from "@nervekit/ui/core/components/Markdown.svelte";
  import { notifyCopyResult } from "@nervekit/ui/core/notify";
  import { isMarkdownPath } from "@nervekit/ui/core/utils/file-display";
  import type { SandboxWorkspaceFileViewState } from "../../state/sandbox-ui-types";

  let { view }: { view?: SandboxWorkspaceFileViewState } = $props();

  let viewportRef = $state<HTMLElement | null>(null);
  let scrolledSignature = $state<string | undefined>(undefined);

  const file = $derived(view?.content);
  const filePath = $derived(file?.relativePath || view?.path);
  const markdown = $derived(isMarkdownPath(filePath));
  const lineStart = $derived(file?.lineStart ?? 1);
  const targetLine = $derived(view?.line ?? file?.targetLine);
  const displayMode = $derived(view?.displayMode ?? "raw");
  const imageSrc = $derived(
    file?.type === "image" && file.dataBase64 && file.mimeType
      ? `data:${file.mimeType};base64,${file.dataBase64}`
      : undefined,
  );
  const textLines = $derived(
    file?.type === "text" && file.text !== undefined ? file.text.split("\n") : [],
  );
  const lastLineNumber = $derived(lineStart + Math.max(0, textLines.length - 1));
  const lineNumberWidth = $derived(
    `${Math.max(2, String(lastLineNumber).length)}ch`,
  );
  const codeViewStyle = $derived(
    `--line-number-width: ${lineNumberWidth}; counter-reset: code-line ${lineStart - 1};`,
  );

  $effect(() => {
    if (!viewportRef || file?.type !== "text" || !targetLine) return;
    const signature = `${file.path}:${lineStart}:${targetLine}:${displayMode}:${textLines.length}`;
    if (scrolledSignature === signature) return;

    void tick().then(() => {
      const target = viewportRef?.querySelector<HTMLElement>(
        `[data-file-line="${targetLine}"]`,
      );
      if (!target) return;
      target.scrollIntoView({ block: "center", inline: "nearest" });
      scrolledSignature = signature;
    });
  });
</script>

<section class="file-pane">
  <ScrollArea
    bind:viewportRef
    class="file-scroll"
    viewportClass="file-viewport"
    type="auto"
    orientation="both"
  >
    {#if !view}
      <div class="file-empty">
        <FileText size={28} strokeWidth={1.7} />
        <strong>No file selected</strong>
        <p>Open a file from a tool result to view it here.</p>
      </div>
    {:else if view.loading && !file}
      <div class="file-empty">
        <RefreshCw class="animate-spin" size={28} strokeWidth={1.7} />
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
          <Markdown
            text={file.text ?? ""}
            trimCodeBlocks={false}
            onCopy={(ok) => notifyCopyResult(ok, "code block")}
          />
        </div>
      {:else}
        <div
          class="code-view"
          class:wrap-lines={view.wrapLines}
          style={codeViewStyle}
          role="region"
          aria-label="File text preview"
        >
          {#each textLines as line, index}
            {@const lineNumber = lineStart + index}
            <span
              class:file-target-line={lineNumber === targetLine}
              class="code-line"
              data-file-line={lineNumber}
            >{line}</span>
          {/each}
        </div>
      {/if}
      {#if file.truncated}
        <p class="file-note">
          Preview truncated{targetLine ? " around the selected line" : ""}.
        </p>
      {/if}
    {:else}
      <div class="file-empty">
        <FileText size={28} strokeWidth={1.7} />
        <strong>Binary preview unavailable</strong>
        <p>
          {file
            ? `${file.name} is ${file.size.toLocaleString()} bytes and cannot be rendered in the browser preview.`
            : "This file can be opened as metadata only for now."}
        </p>
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
    padding: calc(var(--spacing) * 4);
  }

  .file-empty {
    display: grid;
    min-height: calc(var(--spacing) * 72);
    place-items: center;
    align-content: center;
    gap: calc(var(--spacing) * 1.5);
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
    max-width: calc(var(--spacing) * 136);
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
    max-height: 100%;
    object-fit: contain;
  }

  .markdown-view {
    max-width: min(100%, calc(var(--spacing) * 288));
    padding: calc(var(--spacing) * 0.5) calc(var(--spacing) * 1) calc(var(--spacing) * 16);
  }

  .markdown-view :global(.markdown) {
    font-size: var(--text-base);
    line-height: 1.62;
  }

  .code-view {
    --line-number-width: 2ch;
    min-width: 100%;
    margin: 0;
    overflow: visible;
    color: var(--foreground);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.5;
    tab-size: 2;
    white-space: pre;
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

  .code-line {
    display: block;
    min-height: 1.5em;
    padding-right: calc(var(--spacing) * 4);
  }

  .code-view.wrap-lines .code-line {
    padding-left: calc(var(--line-number-width) + calc(var(--spacing) * 4));
    overflow-wrap: anywhere;
    text-indent: calc(-1 * (var(--line-number-width) + calc(var(--spacing) * 4)));
    white-space: pre-wrap;
  }

  .code-line::before {
    counter-increment: code-line;
    content: counter(code-line);
    position: sticky;
    left: 0;
    display: inline-block;
    width: var(--line-number-width);
    margin-right: calc(var(--spacing) * 4);
    background: var(--background);
    color: color-mix(in oklab, var(--muted-foreground) 58%, transparent);
    text-align: right;
    user-select: none;
  }

  .code-line.file-target-line {
    border-radius: calc(var(--radius-sm) * 0.75);
    background: color-mix(in oklab, var(--warning) 18%, transparent);
    box-shadow: inset calc(var(--spacing) * 0.75) 0 0
      color-mix(in oklab, var(--warning) 72%, transparent);
  }

  .code-line.file-target-line::before {
    background: color-mix(in oklab, var(--warning) 18%, var(--background));
    color: var(--foreground);
  }

  .file-note {
    margin: calc(var(--spacing) * 4) 0 0;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }
</style>
