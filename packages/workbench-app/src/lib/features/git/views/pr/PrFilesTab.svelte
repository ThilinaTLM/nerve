<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import FileCode from "@lucide/svelte/icons/file-code";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type {
  GithubPrFile,
  GithubPrFileDiffResponse,
  GithubPrFilesResponse,
} from "@nervekit/contracts/git";
import { Button, buttonVariants } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import * as Resizable from "@nervekit/ui-kit/components/ui/resizable";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { cn } from "@nervekit/ui-kit/utils";
import { buildPanelTree, PanelTree } from "$lib/presentation/panels";
import CodeMirrorGitDiff from "../CodeMirrorGitDiff.svelte";
import type { PrSectionState } from "../github-pr-types";
import { fileStatusLetter, fileStatusTone } from "../pr-pane-helpers";

type Props = {
  files?: GithubPrFilesResponse;
  loading: boolean;
  /** Whether the file list failed; details are reported to Activity. */
  failed?: boolean;
  selectedPath?: string;
  fileDiff?: PrSectionState<GithubPrFileDiffResponse>;
  onRetry?: () => void;
  onSelect?: (path: string) => void;
  onFileDiffRetry?: () => void;
};

let {
  files,
  loading,
  failed,
  selectedPath,
  fileDiff,
  onRetry,
  onSelect,
  onFileDiffRetry,
}: Props = $props();

/* Under narrow widths the tree gives way to a file picker so the diff keeps
 * the full width. */
let width = $state(0);
const compact = $derived(width > 0 && width < 640);
const current = $derived(
  files?.files.find((file) => file.path === selectedPath),
);

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

{#snippet notice(title: string, description: string, retry?: () => void)}
  <Empty.Root class="h-full min-h-0 gap-2 py-6">
    <Empty.Media variant="icon" class="size-8 rounded-md">
      {#if retry}
        <TriangleAlert
          class="size-4 text-muted-foreground"
          aria-hidden="true"
        />
      {:else}
        <FileCode class="size-4" aria-hidden="true" />
      {/if}
    </Empty.Media>
    <Empty.Header class="gap-1">
      <Empty.Title class="text-ui">{title}</Empty.Title>
      <Empty.Description class="text-ui">{description}</Empty.Description>
    </Empty.Header>
    {#if retry}
      <Empty.Content class="gap-1">
        <Button size="sm" variant="outline" onclick={() => retry()}>
          <RotateCcw class="size-3" /> Retry
        </Button>
      </Empty.Content>
    {/if}
  </Empty.Root>
{/snippet}

{#snippet fileLetter(file: GithubPrFile)}
  <span class={cn("font-mono font-medium", fileStatusTone(file.status))}>
    {fileStatusLetter(file.status)}
  </span>
{/snippet}

{#snippet tree(list: GithubPrFilesResponse)}
  <ScrollArea class="h-full" viewportClass="py-1">
    <PanelTree
      nodes={buildPanelTree(list.files, {
        getPath: (file) => file.path.split("/"),
        getKey: (file) => file.path,
      })}
      ariaLabel="Pull request changed files"
      getItemSelected={(file) => file.path === selectedPath}
      getItemTitle={(file) => file.path}
      itemMono
      onItemActivate={(file) => onSelect?.(file.path)}
    >
      {#snippet itemLeading(file)}{@render fileLetter(file)}{/snippet}
      {#snippet itemBadges(file)}
        <span class="font-mono text-success">+{file.additions}</span>
        <span class="font-mono text-destructive">−{file.deletions}</span>
      {/snippet}
    </PanelTree>
    {#if list.truncated}
      <p class="px-3 py-2 text-ui text-warning">
        Partial list: {list.files.length} of {list.totalCount} files.
      </p>
    {/if}
  </ScrollArea>
{/snippet}

{#snippet diffBody()}
  {#if !current}
    {@render notice(
      "No file selected",
      "Select a file from the list to view its diff.",
    )}
  {:else if fileDiff?.error && !fileDiff.data}
    {@render notice(
      "File diff unavailable",
      "Details are in Activity.",
      onFileDiffRetry,
    )}
  {:else if fileDiff?.data?.kind === "text" && fileDiff.data.original !== fileDiff.data.modified}
    {#key current.path}
      <CodeMirrorGitDiff
        original={fileDiff.data.original}
        modified={fileDiff.data.modified}
        path={fileDiff.data.path}
      />
    {/key}
  {:else if fileDiff?.data?.kind === "binary"}
    {@render notice(
      "Binary diff unavailable",
      "GitHub reports that this binary file changed.",
    )}
  {:else if fileDiff?.data?.kind === "unavailable"}
    {@render notice(
      "Preview unavailable",
      unavailableMessage(fileDiff.data.reason),
    )}
  {:else if fileDiff?.data?.kind === "text"}
    {@render notice(
      "No content changes",
      "The file metadata changed without a text difference.",
    )}
  {:else}
    <div
      class="grid h-full min-h-48 place-items-center content-center gap-1.5 text-center text-muted-foreground"
      role="status"
    >
      <Spinner class="size-6 text-primary" />
      <strong class="font-medium text-foreground">Loading file diff</strong>
    </div>
  {/if}
{/snippet}

{#snippet diff(list: GithubPrFilesResponse)}
  <div class="flex h-full min-h-0 min-w-0 flex-col">
    {#if compact}
      <div class="border-b px-2 py-1.5">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class={cn(
              buttonVariants({ variant: "outline" }),
              "w-full justify-between",
            )}
          >
            <span class="truncate font-mono"
              >{current?.path ?? "Choose a file"}</span
            >
            <ChevronDown class="size-3.5" aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content
            align="start"
            class="max-h-80 w-80 overflow-y-auto"
          >
            {#each list.files as file (file.path)}
              <DropdownMenu.Item onSelect={() => onSelect?.(file.path)}>
                {@render fileLetter(file)}
                <span class="truncate font-mono">{file.path}</span>
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    {:else if current}
      <div class="flex shrink-0 items-center border-b px-3 py-1.5">
        <span
          class="min-w-0 flex-1 truncate font-mono text-ui"
          title={current.path}
        >
          {current.path}
          {#if current.previousPath}
            <span class="text-muted-foreground"
              >from {current.previousPath}</span
            >
          {/if}
        </span>
      </div>
    {/if}
    <div class="min-h-0 flex-1 bg-well">{@render diffBody()}</div>
  </div>
{/snippet}

<div class="h-full min-h-0" bind:clientWidth={width}>
  {#if loading && !files}
    <div
      class="flex h-full flex-col gap-2 p-4"
      role="status"
      aria-label="Loading changed files"
    >
      {#each [0, 1, 2, 3, 4, 5] as row (row)}
        <Skeleton class={row % 2 ? "h-3 w-2/3" : "h-3 w-4/5"} />
      {/each}
      <span class="sr-only">Loading changed files</span>
    </div>
  {:else if failed && !files}
    {@render notice(
      "Changed files unavailable",
      "Details are in Activity.",
      onRetry,
    )}
  {:else if files}
    {#if compact}
      {@render diff(files)}
    {:else}
      <Resizable.PaneGroup direction="horizontal" class="h-full">
        <Resizable.Pane defaultSize={30} minSize={18} maxSize={50}>
          {@render tree(files)}
        </Resizable.Pane>
        <Resizable.Handle />
        <Resizable.Pane defaultSize={70} minSize={40}>
          {@render diff(files)}
        </Resizable.Pane>
      </Resizable.PaneGroup>
    {/if}
  {/if}
</div>
