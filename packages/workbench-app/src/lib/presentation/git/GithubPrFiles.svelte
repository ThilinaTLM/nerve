<script lang="ts">
import ExternalLink from "@lucide/svelte/icons/external-link";
import FileCode from "@lucide/svelte/icons/file-code";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import type {
  GithubPrDetail,
  GithubPrFilesResponse,
} from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { buildPanelTree, PanelTree } from "$lib/presentation/panel";
import GithubPrDiff from "./GithubPrDiff.svelte";
import { fileStatusLetter, fileStatusTone } from "./pr-pane-helpers";

type Props = {
  detail: GithubPrDetail;
  files?: GithubPrFilesResponse;
  loading: boolean;
  error?: string;
  selectedPath?: string;
  onRetry?: () => void;
  onSelect?: (path: string) => void;
};

let { detail, files, loading, error, selectedPath, onRetry, onSelect }: Props =
  $props();
const selectedFile = $derived(
  files?.files.find((file) => file.path === selectedPath),
);
const fileUrl = $derived(`${detail.url}/files`);
</script>

{#if loading && !files}
  <div class="grid h-full place-items-center text-sm text-muted-foreground">
    <div class="flex items-center gap-2">
      <Spinner class="size-4" /> Loading changed files…
    </div>
  </div>
{:else if error && !files}
  <div class="grid h-full place-items-center">
    <div class="max-w-md text-center">
      <p class="text-sm text-destructive">{error}</p>
      <Button
        class="mt-3"
        size="sm"
        variant="outline"
        onclick={() => onRetry?.()}
      >
        <RotateCcw class="size-4" /> Retry
      </Button>
    </div>
  </div>
{:else if files}
  <div class="@container h-full min-h-0">
    <div
      class="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] @4xl:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)] @4xl:grid-rows-1"
    >
      <aside
        class="flex min-h-0 flex-col border-b bg-sidebar @4xl:border-r @4xl:border-b-0"
      >
        <div class="flex items-center justify-between border-b px-3 py-2">
          <span class="text-xs font-semibold"
            >{files.totalCount} changed files</span
          >
          {#if files.truncated}
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              class="text-xs text-warning hover:underline"
            >
              Partial data
            </a>
          {/if}
        </div>
        <ScrollArea
          class="h-48 @4xl:h-auto @4xl:min-h-0 @4xl:flex-1"
          viewportClass="py-1"
        >
          <PanelTree
            nodes={buildPanelTree(files.files, {
              getPath: (file) => file.path.split("/"),
              getKey: (file) => file.path,
            })}
            ariaLabel="Pull request changed files"
            getItemSelected={(file) => file.path === selectedPath}
            getItemTitle={(file) => file.path}
            itemMono
            onItemActivate={(file) => onSelect?.(file.path)}
          >
            {#snippet itemLeading(file)}
              <span
                class={`font-mono font-semibold ${fileStatusTone(file.status)}`}
              >
                {fileStatusLetter(file.status)}
              </span>
            {/snippet}
            {#snippet itemBadges(file)}
              <span class="font-mono text-success">+{file.additions}</span>
              <span class="font-mono text-destructive">−{file.deletions}</span>
            {/snippet}
          </PanelTree>
        </ScrollArea>
      </aside>

      <section class="flex min-h-0 min-w-0 flex-col bg-background">
        {#if selectedFile}
          <div
            class="flex items-center justify-between gap-3 border-b px-3 py-2"
          >
            <div class="min-w-0">
              <p
                class="truncate font-mono text-xs font-semibold"
                title={selectedFile.path}
              >
                {selectedFile.path}
              </p>
              {#if selectedFile.previousPath}
                <p class="truncate font-mono text-xs text-muted-foreground">
                  from {selectedFile.previousPath}
                </p>
              {/if}
            </div>
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              GitHub <ExternalLink class="size-3.5" />
            </a>
          </div>
          <ScrollArea class="min-h-0 flex-1" orientation="both">
            {#if selectedFile.patch}
              <GithubPrDiff patch={selectedFile.patch} />
              {#if selectedFile.patchTruncated}
                <p class="border-t p-3 text-xs text-warning">
                  This patch was truncated. Open it on GitHub to view the
                  complete diff.
                </p>
              {/if}
            {:else}
              <div class="grid min-h-64 place-items-center p-6 text-center">
                <div>
                  <FileCode class="mx-auto size-7 text-muted-foreground" />
                  <p class="mt-2 text-sm font-medium">Preview unavailable</p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    GitHub may omit patches for binary or very large files.
                  </p>
                </div>
              </div>
            {/if}
          </ScrollArea>
        {:else}
          <div
            class="grid h-full place-items-center text-sm text-muted-foreground"
          >
            Select a file to view its diff.
          </div>
        {/if}
      </section>
    </div>
  </div>
{/if}
