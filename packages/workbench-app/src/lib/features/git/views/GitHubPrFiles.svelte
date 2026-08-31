<script lang="ts">
import ExternalLink from "@lucide/svelte/icons/external-link";
import FileCode from "@lucide/svelte/icons/file-code";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import type {
  GithubPrCore,
  GithubPrFileDiffResponse,
  GithubPrFilesResponse,
} from "@nervekit/contracts/git";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { buildPanelTree, PanelTree } from "$lib/presentation/panels";
import CodeMirrorGitDiff from "./CodeMirrorGitDiff.svelte";
import GitHubPrSection from "./GitHubPrSection.svelte";
import type { PrSectionState } from "./github-pr-types";
import { fileStatusLetter, fileStatusTone } from "./pr-pane-helpers";

type Props = {
  detail: GithubPrCore;
  files?: GithubPrFilesResponse;
  loading: boolean;
  error?: string;
  selectedPath?: string;
  fileDiff?: PrSectionState<GithubPrFileDiffResponse>;
  onRetry?: () => void;
  onSelect?: (path: string) => void;
  onFileDiffRetry?: () => void;
};

let {
  detail,
  files,
  loading,
  error,
  selectedPath,
  fileDiff,
  onRetry,
  onSelect,
  onFileDiffRetry,
}: Props = $props();
const selectedFile = $derived(
  files?.files.find((file) => file.path === selectedPath),
);
const fileUrl = $derived(`${detail.url}/files`);

function unavailableMessage(
  reason: Extract<GithubPrFileDiffResponse, { kind: "unavailable" }>["reason"],
): string {
  if (reason === "content-too-large")
    return "This file is too large for a complete in-app diff.";
  if (reason === "repository-unavailable")
    return "The source repository is no longer available.";
  return "GitHub could not provide complete content for this file.";
}
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
      <GitHubPrSection
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
      </GitHubPrSection>

      <GitHubPrSection
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
          {#if fileDiff?.loading && !fileDiff.data}
            <div
              class="grid h-full min-h-48 place-items-center content-center gap-1.5 text-center text-muted-foreground"
              role="status"
            >
              <Spinner class="size-6 text-primary" />
              <strong class="text-foreground">Loading file diff</strong>
            </div>
          {:else if fileDiff?.error && !fileDiff.data}
            <Empty.Root class="h-full min-h-0 gap-2 py-6">
              <Empty.Media variant="icon" class="size-8 rounded-md">
                <TriangleAlert
                  class="size-4 text-destructive"
                  aria-hidden="true"
                />
              </Empty.Media>
              <Empty.Header class="gap-1">
                <Empty.Title class="text-sm font-medium"
                  >Could not load file diff</Empty.Title
                >
                <Empty.Description class="text-xs text-destructive"
                  >{fileDiff.error}</Empty.Description
                >
              </Empty.Header>
              <Empty.Content>
                <Button
                  size="xs"
                  variant="outline"
                  onclick={() => onFileDiffRetry?.()}
                >
                  <RotateCcw class="size-3" /> Retry
                </Button>
              </Empty.Content>
            </Empty.Root>
          {:else if fileDiff?.data?.kind === "text" && fileDiff.data.original !== fileDiff.data.modified}
            <CodeMirrorGitDiff
              original={fileDiff.data.original}
              modified={fileDiff.data.modified}
              path={fileDiff.data.path}
            />
          {:else if fileDiff?.data?.kind === "binary"}
            <Empty.Root class="h-full min-h-0 gap-2 py-6">
              <Empty.Media variant="icon" class="size-8 rounded-md">
                <FileCode class="size-4" aria-hidden="true" />
              </Empty.Media>
              <Empty.Header class="gap-1">
                <Empty.Title class="text-sm font-medium"
                  >Binary diff unavailable</Empty.Title
                >
                <Empty.Description class="text-xs">
                  GitHub reports that this binary file changed.
                </Empty.Description>
              </Empty.Header>
            </Empty.Root>
          {:else if fileDiff?.data?.kind === "unavailable"}
            <Empty.Root class="h-full min-h-0 gap-2 py-6">
              <Empty.Media variant="icon" class="size-8 rounded-md">
                <FileCode class="size-4" aria-hidden="true" />
              </Empty.Media>
              <Empty.Header class="gap-1">
                <Empty.Title class="text-sm font-medium"
                  >Preview unavailable</Empty.Title
                >
                <Empty.Description class="text-xs">
                  {unavailableMessage(fileDiff.data.reason)}
                </Empty.Description>
              </Empty.Header>
            </Empty.Root>
          {:else if fileDiff?.data?.kind === "text"}
            <Empty.Root class="h-full min-h-0 gap-2 py-6">
              <Empty.Media variant="icon" class="size-8 rounded-md">
                <FileCode class="size-4" aria-hidden="true" />
              </Empty.Media>
              <Empty.Header class="gap-1">
                <Empty.Title class="text-sm font-medium"
                  >No content changes</Empty.Title
                >
                <Empty.Description class="text-xs">
                  The file metadata changed without a text difference.
                </Empty.Description>
              </Empty.Header>
            </Empty.Root>
          {:else}
            <div
              class="grid h-full min-h-48 place-items-center content-center gap-1.5 text-center text-muted-foreground"
              role="status"
            >
              <Spinner class="size-6 text-primary" />
              <strong class="text-foreground">Loading file diff</strong>
            </div>
          {/if}
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
      </GitHubPrSection>
    </div>
  </div>
{/if}
