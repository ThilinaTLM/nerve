<script lang="ts">
  import { tick } from "svelte";
  import FileText from "@lucide/svelte/icons/file-text";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Markdown from "@nervekit/workbench-ui/core/components/Markdown.svelte";
  import { notifyCopyResult } from "$lib/features/notifications/notify.svelte";
  import type { FileViewState } from "$lib/core/types/state-types";
  import { extname } from "@nervekit/workbench-ui/tools/views/lang";
  import { defaultFileDisplayMode, isMarkdownPath } from "$lib/core/utils/file-display";
  import { CodeViewer } from "@nervekit/workbench-ui/components/workbench";
  import { ScrollArea } from "@nervekit/workbench-ui/components/ui/scroll-area";

  type Props = {
    view?: FileViewState;
  };

  let { view }: Props = $props();

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
  const imageSrc = $derived(
    file?.type === "image" && file.dataBase64 && file.mimeType
      ? `data:${file.mimeType};base64,${file.dataBase64}`
      : undefined,
  );
  const textLength = $derived(
    file?.type === "text" && file.text !== undefined ? file.text.length : 0,
  );

  $effect(() => {
    if (!viewportRef || file?.type !== "text" || !targetLine) return;
    const signature = `${file.path}:${lineStart}:${targetLine}:${displayMode}:${textLength}`;
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
      {:else}
        <CodeViewer
          text={file.text ?? ""}
          {language}
          {lineStart}
          {targetLine}
          wrap={view?.wrapLines}
        />
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
</style>
