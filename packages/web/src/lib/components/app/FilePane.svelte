<script lang="ts">
  import Clipboard from "@lucide/svelte/icons/clipboard";
  import FileText from "@lucide/svelte/icons/file-text";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { toast } from "svelte-sonner";
  import { highlightCodeCached } from "../../highlight";
  import type { FileViewState } from "../../stores/workbench/state.svelte";
  import { extname } from "../../tool-views/lang";
  import { Button } from "$lib/components/ui/button";
  import { ScrollArea } from "$lib/components/ui/scroll-area";

  type Props = {
    view?: FileViewState;
    homeDir?: string;
    onRefresh?: (id: string) => void;
  };

  let { view, homeDir: _homeDir, onRefresh }: Props = $props();
  void _homeDir;

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
  const displayPath = $derived(file?.relativePath ?? view?.path ?? "File");
  const imageSrc = $derived(
    file?.type === "image" && file.dataBase64 && file.mimeType
      ? `data:${file.mimeType};base64,${file.dataBase64}`
      : undefined,
  );
  const sizeLabel = $derived(
    file ? `${file.size.toLocaleString()} bytes${file.truncated ? " · truncated" : ""}` : "",
  );

  $effect(() => {
    if (file?.type !== "text" || file.text === undefined || !codeSignature) return;
    const currentSignature = codeSignature;
    if (htmlSignature === currentSignature || unavailableSignature === currentSignature) return;

    const result = highlightCodeCached(file.text, language);
    if (typeof result === "string") {
      html = result;
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
        html = highlighted;
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

  async function copyPath() {
    const path = file?.path ?? view?.path;
    if (!path) return;
    try {
      await navigator.clipboard?.writeText(path);
      toast.success("Copied file path");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }
</script>

<section class="file-pane">
  <header class="file-header">
    <div class="file-heading">
      <FileText size={16} strokeWidth={2.15} aria-hidden="true" />
      <div class="file-title-block">
        <strong>{file?.name ?? "File"}</strong>
        <span title={file?.path ?? view?.path}>{displayPath}</span>
      </div>
    </div>
    <div class="file-actions">
      {#if view?.line}<span class="file-size">line {view.line}</span>{/if}
      {#if sizeLabel}<span class="file-size">{sizeLabel}</span>{/if}
      <Button variant="ghost" size="sm" onclick={copyPath} disabled={!view}>
        <Clipboard size={13} strokeWidth={2.2} />Copy path
      </Button>
      <Button variant="ghost" size="sm" onclick={() => view && onRefresh?.(view.id)} disabled={!view || view.loading}>
        <RefreshCw size={13} strokeWidth={2.2} />Refresh
      </Button>
    </div>
  </header>

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
        <div class="code-view">{@html html}</div>
      {:else}
        <pre class="code-view plain">{file.text}</pre>
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
    grid-template-rows: auto minmax(0, 1fr);
    background: var(--background);
  }

  .file-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-width: 0;
    border-bottom: 1px solid var(--border);
    background: var(--muted);
    padding: 0.62rem 0.75rem;
  }

  .file-heading,
  .file-actions {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.55rem;
  }

  .file-heading :global(svg) {
    flex: none;
    color: var(--primary);
  }

  .file-title-block {
    display: grid;
    min-width: 0;
    gap: 0.1rem;
  }

  .file-title-block strong {
    overflow: hidden;
    color: var(--foreground);
    font-size: 0.875rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-title-block span,
  .file-size {
    overflow: hidden;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-actions {
    flex: none;
  }

  :global(.file-scroll) {
    min-height: 0;
  }

  :global(.file-viewport) {
    padding: 0.75rem;
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
    font-size: 0.8125rem;
  }

  .image-wrap {
    display: grid;
    min-height: 100%;
    place-items: center;
  }

  .image-wrap img {
    max-width: 100%;
    max-height: calc(100vh - 9rem);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--card);
    object-fit: contain;
  }

  .code-view {
    margin: 0;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    padding: 0.75rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .code-view.plain {
    white-space: pre;
  }

  .code-view :global(pre) {
    margin: 0;
    background: transparent !important;
    white-space: pre;
  }

  .code-view :global(code) {
    font-family: var(--font-mono);
    font-size: 0.75rem;
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
