<script lang="ts">
import ExternalLink from "@lucide/svelte/icons/external-link";
import FileCode from "@lucide/svelte/icons/file-code";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import type { GithubPrCore, GithubPrFilesResponse } from "@nervekit/contracts";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { buildPanelTree, PanelTree } from "$lib/presentation/panel";
import GithubPrDiff from "./GithubPrDiff.svelte";
import GithubPrSection from "./GithubPrSection.svelte";
import { fileStatusLetter, fileStatusTone } from "./pr-pane-helpers";

type Props = {
  detail: GithubPrCore;
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
  <div
    class="@container h-full min-h-0 px-4 pt-1 pb-3"
    role="status"
    aria-label="Loading changed files"
  >
    <div
      class="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-2 @2xl:grid-cols-[18rem_minmax(0,1fr)] @2xl:grid-rows-1"
    >
      <div
        class="flex h-56 flex-col gap-2 rounded-md border border-border/60 bg-card px-3 py-3 @2xl:h-auto"
      >
        <Skeleton class="h-3 w-24" />
        {#each [0, 1, 2, 3, 4, 5] as row (row)}
          <div class="flex items-center gap-2 border-t border-border/60 pt-2">
            <Skeleton class="size-3" />
            <Skeleton class={row % 2 ? "h-3 w-2/3" : "h-3 w-4/5"} />
          </div>
        {/each}
      </div>
      <div
        class="flex min-h-0 flex-col gap-2 rounded-md border border-border/60 bg-card px-3 py-3"
      >
        <Skeleton class="h-3 w-1/3" />
        <Skeleton class="h-4 w-full" />
        <Skeleton class="h-4 w-11/12" />
        <Skeleton class="h-4 w-4/5" />
        <Skeleton class="h-4 w-full" />
      </div>
    </div>
    <span class="sr-only">Loading changed files</span>
  </div>
{:else if error && !files}
  <Empty.Root class="h-full min-h-0 gap-2 py-6">
    <Empty.Media variant="icon" class="size-8 rounded-md">
      <TriangleAlert class="size-4 text-destructive" aria-hidden="true" />
    </Empty.Media>
    <Empty.Header class="gap-1">
      <Empty.Title class="text-sm font-medium"
        >Could not load changed files</Empty.Title
      >
      <Empty.Description class="text-xs text-destructive"
        >{error}</Empty.Description
      >
    </Empty.Header>
    <Empty.Content class="gap-1">
      <Button size="xs" variant="outline" onclick={() => onRetry?.()}>
        <RotateCcw class="size-3" /> Retry
      </Button>
    </Empty.Content>
  </Empty.Root>
{:else if files}
  <div class="@container h-full min-h-0 px-4 pt-1 pb-3">
    <div
      class="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-2 @2xl:grid-cols-[18rem_minmax(0,1fr)] @2xl:grid-rows-1"
    >
      <GithubPrSection
        title={`${files.totalCount} changed files`}
        class="flex h-56 min-h-0 flex-col overflow-hidden @2xl:h-auto"
        contentClass="min-h-0 flex-1 p-0"
      >
        {#snippet actions()}
          {#if files.truncated}
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              class="text-xs font-normal text-warning hover:underline"
            >
              Partial data
            </a>
          {/if}
        {/snippet}
        <ScrollArea class="h-full" viewportClass="py-1">
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
      </GithubPrSection>

      <GithubPrSection
        class="flex min-h-0 min-w-0 flex-col overflow-hidden"
        contentClass="min-h-0 flex-1 p-0"
      >
        {#snippet header()}
          {#if selectedFile}
            <span
              class="min-w-0 flex-1 truncate font-mono font-medium text-foreground"
              title={selectedFile.path}
            >
              {selectedFile.path}
              {#if selectedFile.previousPath}
                <span class="font-normal text-muted-foreground"
                  >from {selectedFile.previousPath}</span
                >
              {/if}
            </span>
          {:else}
            <span class="min-w-0 flex-1 truncate text-muted-foreground"
              >Diff</span
            >
          {/if}
        {/snippet}
        {#snippet actions()}
          <a
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            class="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            GitHub <ExternalLink class="size-3" />
          </a>
        {/snippet}

        {#if selectedFile}
          <ScrollArea class="h-full" orientation="both">
            {#if selectedFile.patch}
              <GithubPrDiff patch={selectedFile.patch} />
              {#if selectedFile.patchTruncated}
                <p
                  class="border-t border-border/60 px-3 py-2 text-xs text-warning"
                >
                  This patch was truncated. Open it on GitHub to view the
                  complete diff.
                </p>
              {/if}
            {:else}
              <Empty.Root class="gap-2 py-6">
                <Empty.Media variant="icon" class="size-8 rounded-md">
                  <FileCode class="size-4" aria-hidden="true" />
                </Empty.Media>
                <Empty.Header class="gap-1">
                  <Empty.Title class="text-sm font-medium"
                    >Preview unavailable</Empty.Title
                  >
                  <Empty.Description class="text-xs">
                    GitHub may omit patches for binary or very large files.
                  </Empty.Description>
                </Empty.Header>
              </Empty.Root>
            {/if}
          </ScrollArea>
        {:else}
          <Empty.Root class="h-full min-h-0 gap-2 py-6">
            <Empty.Media variant="icon" class="size-8 rounded-md">
              <FileCode class="size-4" aria-hidden="true" />
            </Empty.Media>
            <Empty.Header class="gap-1">
              <Empty.Title class="text-sm font-medium"
                >No file selected</Empty.Title
              >
              <Empty.Description class="text-xs"
                >Select a file from the list to view its diff.</Empty.Description
              >
            </Empty.Header>
          </Empty.Root>
        {/if}
      </GithubPrSection>
    </div>
  </div>
{/if}
