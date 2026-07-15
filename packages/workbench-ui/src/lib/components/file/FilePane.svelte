<script lang="ts">
import FileText from "@lucide/svelte/icons/file-text";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import Markdown from "@nervekit/ui-kit/core/components/Markdown.svelte";
import { notifyCopyResult } from "@nervekit/ui-kit/core/notify";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { tick } from "svelte";
import CodeViewer from "../workbench/code-viewer.svelte";
import { resolveFilePaneModel } from "./file-pane-model.js";
import type { FilePaneViewModel } from "./types.js";

let { view }: { view?: FilePaneViewModel } = $props();

let viewportRef = $state<HTMLElement | null>(null);
let scrolledSignature = $state<string | undefined>(undefined);

const resolved = $derived(view ? resolveFilePaneModel(view) : undefined);
const file = $derived(view?.content);

$effect(() => {
  const signature = resolved?.scrollSignature;
  const targetLine = resolved?.targetLine;
  if (
    !viewportRef ||
    !signature ||
    !targetLine ||
    scrolledSignature === signature
  )
    return;

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

<section class="grid h-full min-h-0 min-w-0 bg-background">
  <ScrollArea
    bind:viewportRef
    class="min-h-0 min-w-0"
    viewportClass="p-4"
    type="auto"
    orientation="both"
  >
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
    {:else if file?.type === "text" && resolved}
      {#if resolved.markdown && resolved.displayMode === "rendered"}
        <div class="max-w-6xl px-1 pb-16 pt-0.5">
          <Markdown
            text={file.text ?? ""}
            trimCodeBlocks={false}
            onCopy={(ok) => notifyCopyResult(ok, "code block")}
          />
        </div>
      {:else}
        <CodeViewer
          text={file.text ?? ""}
          language={resolved.language}
          lineStart={resolved.lineStart}
          targetLine={resolved.targetLine}
          wrap={view.wrapLines}
        />
      {/if}
      {#if file.truncated}
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
</section>
