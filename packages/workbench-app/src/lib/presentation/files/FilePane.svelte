<script lang="ts">
import FileText from "@lucide/svelte/icons/file-text";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import type { MermaidMarkdownBlock } from "@nervekit/ui-kit/renderers/mermaid/mermaid-blocks";
import { notifyCopyResult } from "@nervekit/ui-kit/browser/notifications";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { CodeMirrorViewer } from "$lib/presentation/code";
import { MermaidPane } from "$lib/presentation/mermaid";
import { resolveFilePaneModel } from "./file-pane-model.js";
import type { FilePaneViewModel } from "./file-pane-contracts.js";

let {
  view,
  onOpenFile,
  onOpenMermaid,
  highlightSelectionMatches = false,
  onToggleSelectionMatches,
  onToggleWrap,
  onChange,
  onSave,
}: {
  view?: FilePaneViewModel;
  onOpenFile?: (path: string, line?: number) => void;
  onOpenMermaid?: (block: MermaidMarkdownBlock) => void;
  highlightSelectionMatches?: boolean;
  onToggleSelectionMatches?: () => void;
  onToggleWrap?: () => void;
  onChange?: (text: string) => void;
  onSave?: () => void;
} = $props();

const resolved = $derived(view ? resolveFilePaneModel(view) : undefined);
const file = $derived(view?.content);
const showRawText = $derived(
  file?.type === "text" &&
    resolved &&
    !(resolved.renderKind && resolved.displayMode === "rendered"),
);
const showMermaidPreview = $derived(
  file?.type === "text" &&
    resolved?.renderKind === "mermaid" &&
    resolved.displayMode === "rendered",
);
</script>

<section class="grid h-full min-h-0 min-w-0 bg-background">
  {#if showRawText && file?.type === "text" && resolved}
    <div class="flex min-h-0 min-w-0 flex-col">
      <CodeMirrorViewer
        class="min-h-0 flex-1"
        text={view?.draft ?? file.text ?? ""}
        language={resolved.language}
        lineStart={resolved.lineStart}
        targetLine={resolved.targetLine}
        wrap={view?.wrapLines}
        ariaLabel={`File contents: ${resolved.filePath}`}
        onCopy={(ok) => notifyCopyResult(ok, "selection")}
        {highlightSelectionMatches}
        {onToggleSelectionMatches}
        {onToggleWrap}
        editable={Boolean(file.editable && !file.truncated)}
        originalText={file.editable && !file.truncated
          ? (file.text ?? "")
          : undefined}
        {onChange}
        {onSave}
      />
      {#if view?.saveError}
        <p
          class="m-0 border-t border-destructive/40 bg-destructive/8 px-4 py-2 text-xs text-destructive"
        >
          Save failed: {view.saveError}
        </p>
      {:else if view?.saving}
        <p
          class="m-0 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground"
        >
          Saving…
        </p>
      {:else if file.truncated}
        <p
          class="m-0 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground"
        >
          Preview truncated{resolved.targetLine
            ? " around the selected line"
            : ""}. Editing is unavailable.
        </p>
      {:else if !file.editable}
        <p
          class="m-0 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground"
        >
          Read-only: only small, regular text files inside the project can be
          edited.
        </p>
      {/if}
    </div>
  {:else if showMermaidPreview && file?.type === "text" && resolved}
    <MermaidPane
      source={view?.draft ?? file.text ?? ""}
      truncated={file.truncated}
      ariaLabel={`Mermaid diagram: ${resolved.filePath}`}
    />
    {#if view?.dirty}
      <p
        class="m-0 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground"
      >
        Previewing unsaved changes.
      </p>
    {/if}
  {:else}
    <ScrollArea class="min-h-0 min-w-0" viewportClass="p-4" orientation="both">
      {#if !view}
        <div
          class="grid min-h-72 place-items-center content-center gap-1.5 text-center text-muted-foreground"
        >
          <FileText class="size-7 text-primary" strokeWidth={1.7} />
          <strong class="text-foreground">No file selected</strong>
          <p class="m-0 max-w-xl text-sm">
            Open a file from a tool result to view it here.
          </p>
        </div>
      {:else if view.loading && !file}
        <div
          class="grid min-h-72 place-items-center content-center gap-1.5 text-center text-muted-foreground"
        >
          <Spinner class="size-7 text-primary" />
          <strong class="text-foreground">Loading file</strong>
          <p class="m-0 max-w-xl font-mono text-sm">{view.path}</p>
        </div>
      {:else if view.error}
        <div
          class="grid min-h-72 place-items-center content-center gap-1.5 text-center text-muted-foreground"
        >
          <TriangleAlert class="size-7 text-destructive" strokeWidth={1.7} />
          <strong class="text-foreground">Could not open file</strong>
          <p class="m-0 max-w-xl text-sm">{view.error}</p>
        </div>
      {:else if resolved?.imageSrc}
        <div class="grid min-h-full place-items-center">
          <img
            class="max-h-full max-w-full object-contain"
            src={resolved.imageSrc}
            alt={file?.relativePath ?? file?.name ?? "File preview"}
          />
        </div>
      {:else if file?.type === "text" && resolved?.renderKind === "markdown"}
        <div class="mx-auto max-w-6xl px-1 pb-16 pt-0.5">
          <Markdown
            text={view?.draft ?? file.text ?? ""}
            trimCodeBlocks={false}
            linkBasePath={resolved.linkBasePath}
            sourceLineStart={file.lineStart ?? 1}
            {onOpenFile}
            {onOpenMermaid}
            onCopy={(ok) => notifyCopyResult(ok, "code block")}
          />
        </div>
        {#if view?.dirty}
          <p class="mt-4 text-xs text-muted-foreground">
            Previewing unsaved changes.
          </p>
        {:else if file.truncated}
          <p class="mt-4 text-xs text-muted-foreground">
            Preview truncated{resolved.targetLine
              ? " around the selected line"
              : ""}.
          </p>
        {/if}
      {:else}
        <div
          class="grid min-h-72 place-items-center content-center gap-1.5 text-center text-muted-foreground"
        >
          <FileText class="size-7 text-primary" strokeWidth={1.7} />
          <strong class="text-foreground">Binary preview unavailable</strong>
          <p class="m-0 max-w-xl text-sm">
            {file
              ? `${file.name} is ${file.size.toLocaleString()} bytes and cannot be rendered in the browser preview.`
              : "This file can be opened as metadata only for now."}
          </p>
        </div>
      {/if}
    </ScrollArea>
  {/if}
</section>
