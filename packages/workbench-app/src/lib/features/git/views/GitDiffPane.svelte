<script lang="ts">
import FileCode from "@lucide/svelte/icons/file-code";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import CodeMirrorGitDiff from "./CodeMirrorGitDiff.svelte";
import type { GitDiffPaneModel } from "./git-diff-types";

type Props = {
  view?: GitDiffPaneModel;
  wrap?: boolean;
  highlightSelectionMatches?: boolean;
  onRefresh: () => void;
  onCopy?: (ok: boolean) => void;
  onToggleSelectionMatches?: () => void;
  onToggleWrap?: () => void;
};

let {
  view,
  wrap = false,
  highlightSelectionMatches = false,
  onRefresh,
  onCopy,
  onToggleSelectionMatches,
  onToggleWrap,
}: Props = $props();
const textDiff = $derived(view?.data?.binary === false ? view.data : undefined);
const hasChanges = $derived(
  Boolean(textDiff && textDiff.original !== textDiff.modified),
);
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-background">
  {#if textDiff && hasChanges}
    <div class="min-h-0 min-w-0 flex-1">
      <CodeMirrorGitDiff
        original={textDiff.original}
        modified={textDiff.modified}
        path={textDiff.path}
        {wrap}
        {highlightSelectionMatches}
        {onCopy}
        {onToggleSelectionMatches}
        {onToggleWrap}
      />
    </div>
  {:else}
    <ScrollArea class="min-h-0 min-w-0 flex-1" orientation="both">
      {#if !view}
        <div
          class="grid min-h-72 place-items-center content-center gap-1.5 text-center text-muted-foreground"
        >
          <FileCode class="size-7 text-primary" strokeWidth={1.7} />
          <strong class="text-foreground">No diff selected</strong>
        </div>
      {:else if view.loading && !view.data}
        <div
          class="grid min-h-72 place-items-center content-center gap-1.5 text-center text-muted-foreground"
        >
          <Spinner class="size-7 text-primary" />
          <strong class="text-foreground">Loading diff</strong>
          <p class="m-0 max-w-xl font-mono text-sm">{view.path}</p>
        </div>
      {:else if view.error && !view.data}
        <div
          class="grid min-h-72 place-items-center content-center gap-2 text-center text-muted-foreground"
        >
          <TriangleAlert class="size-7 text-destructive" strokeWidth={1.7} />
          <strong class="text-foreground">Could not load diff</strong>
          <p class="m-0 max-w-xl text-sm">{view.error}</p>
          <Button variant="outline" size="sm" onclick={onRefresh}>Retry</Button>
        </div>
      {:else if view.data?.binary}
        <div
          class="grid min-h-72 place-items-center content-center gap-1.5 text-center text-muted-foreground"
        >
          <FileCode class="size-7 text-primary" strokeWidth={1.7} />
          <strong class="text-foreground">Binary diff unavailable</strong>
          <p class="m-0 max-w-xl text-sm">
            Git reports that this binary file changed.
          </p>
        </div>
      {:else}
        <div
          class="grid min-h-72 place-items-center content-center gap-1.5 text-center text-muted-foreground"
        >
          <FileCode class="size-7" strokeWidth={1.7} />
          <strong class="text-foreground">No {view.area} changes</strong>
          <p class="m-0 max-w-xl text-sm">
            This file no longer differs in this comparison.
          </p>
        </div>
      {/if}
    </ScrollArea>
  {/if}
  {#if view?.data && view.error}
    <p class="m-0 border-t border-border/60 px-3 py-2 text-xs text-destructive">
      Refresh failed: {view.error}
    </p>
  {/if}
</section>
