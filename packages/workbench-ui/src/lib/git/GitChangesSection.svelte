<script lang="ts">
import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
import ArrowUpFromLine from "@lucide/svelte/icons/arrow-up-from-line";
import FilePen from "@lucide/svelte/icons/file-pen";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import X from "@lucide/svelte/icons/x";
import type { GitFileChange } from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { cn } from "@nervekit/ui-kit/core/utils";
import { PanelSection } from "@nervekit/workbench-ui/components/workbench";
import type { FileMutation, GitPanelCapabilities } from "./git-panel-types";
import {
  fileStatusLabel,
  fileTone,
  shortenPath,
  splitPath,
  statusLetter,
} from "./git-change-format";

type ChangesState = {
  files: readonly GitFileChange[];
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
};

type Props = {
  changes?: ChangesState;
  stagedFiles: GitFileChange[];
  unstagedFiles: GitFileChange[];
  fileMutation?: FileMutation;
  bulkMutation?: string;
  selectedRepo: string;
  loadingOverview: boolean;
  capabilities: GitPanelCapabilities;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onMutateFile: (
    repo: string,
    file: GitFileChange,
    action: "stage" | "unstage" | "discard",
  ) => void;
  onBulkStage: (repo: string, action: "stage-all" | "unstage-all") => void;
  onRefresh: (repo: string) => void;
  onRequestDiscard: (file: GitFileChange) => void;
};

let {
  changes,
  stagedFiles,
  unstagedFiles,
  fileMutation,
  bulkMutation,
  selectedRepo,
  loadingOverview,
  capabilities,
  open = $bindable(true),
  onOpenChange,
  onMutateFile,
  onBulkStage,
  onRefresh,
  onRequestDiscard,
}: Props = $props();
</script>

{#snippet changeRow(file: GitFileChange, group: "staged" | "unstaged")}
  {@const parts = splitPath(shortenPath(file.path))}
  {@const busy = fileMutation?.path === file.path}
  <div class="group flex min-h-0 items-center gap-1 px-1 text-xs leading-tight">
    <span
      class={cn(
        "w-3 shrink-0 text-center font-mono font-semibold",
        fileTone(file),
      )}
      title={fileStatusLabel(file, group)}
    >
      {statusLetter(file, group)}
    </span>
    <div class="min-w-0 flex-1 truncate font-mono" title={file.path}>
      {#if parts.dir}<span class="text-muted-foreground">{parts.dir}</span
        >{/if}<span class="text-foreground">{parts.base}</span>
    </div>
    <div
      class="flex w-9 shrink-0 items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
    >
      {#if group === "staged"}
        <Button
          size="icon-xs"
          class="size-4"
          variant="ghost"
          ariaLabel={`Unstage ${file.path}`}
          title="Unstage"
          disabled={!capabilities.mutateFiles.enabled || busy}
          onclick={() => onMutateFile(selectedRepo, file, "unstage")}
        >
          {#if busy && fileMutation?.action === "unstage"}
            <Spinner />
          {:else}
            <ArrowDownToLine />
          {/if}
        </Button>
      {:else}
        <Button
          size="icon-xs"
          class="size-4"
          variant="ghost"
          ariaLabel={`Stage ${file.path}`}
          title="Stage"
          disabled={!capabilities.mutateFiles.enabled || busy}
          onclick={() => onMutateFile(selectedRepo, file, "stage")}
        >
          {#if busy && fileMutation?.action === "stage"}
            <Spinner />
          {:else}
            <ArrowUpFromLine />
          {/if}
        </Button>
      {/if}
      <Button
        size="icon-xs"
        class="size-4"
        variant="ghost"
        ariaLabel={`Discard ${file.path}`}
        title="Discard"
        disabled={!capabilities.mutateFiles.enabled || busy}
        onclick={() => onRequestDiscard(file)}
      >
        {#if busy && fileMutation?.action === "discard"}
          <Spinner />
        {:else}
          <X />
        {/if}
      </Button>
    </div>
  </div>
{/snippet}

<PanelSection
  title="Changes"
  icon={FilePen}
  contentClass="px-2 py-1.5"
  bind:open
  {onOpenChange}
>
  {#snippet meta()}
    {#if changes}
      <span
        class="flex items-center gap-0.5"
        aria-label={`${changes.stagedCount} staged`}
        title={`${changes.stagedCount} staged`}
      >
        <ArrowUpFromLine class="size-3" aria-hidden="true" />
        <span>{changes.stagedCount}</span>
      </span>
      <span class="text-muted-foreground/50">·</span>
      <span
        class="flex items-center gap-0.5"
        aria-label={`${changes.unstagedCount + changes.untrackedCount} unstaged`}
        title={`${changes.unstagedCount + changes.untrackedCount} unstaged`}
      >
        <ArrowDownToLine class="size-3" aria-hidden="true" />
        <span>{changes.unstagedCount + changes.untrackedCount}</span>
      </span>
    {/if}
  {/snippet}

  {#snippet actions()}
    <Button
      size="icon-xs"
      variant="ghost"
      ariaLabel="Refresh changes"
      title="Refresh changes"
      disabled={!capabilities.refresh.enabled || loadingOverview}
      onclick={() => onRefresh(selectedRepo)}
    >
      <RefreshCw class={loadingOverview ? "animate-spin" : ""} />
    </Button>
  {/snippet}

  {#if loadingOverview && !changes}
    <div class="py-1 text-xs text-muted-foreground">Loading…</div>
  {:else if changes}
    {#if changes.files.length === 0}
      <p class="py-1 text-xs text-muted-foreground">Working tree clean.</p>
    {:else}
      <div class="flex flex-col gap-1">
        {#if stagedFiles.length > 0}
          <div class="flex flex-col gap-0.5">
            <div
              class="flex h-5 items-center gap-1 px-1 text-xs font-medium text-muted-foreground"
            >
              <span>Staged</span>
              <Button
                size="icon-xs"
                class="size-5"
                variant="ghost"
                ariaLabel="Unstage all"
                title="Unstage all"
                disabled={!capabilities.bulkMutateFiles.enabled ||
                  Boolean(bulkMutation) ||
                  Boolean(fileMutation)}
                onclick={() => onBulkStage(selectedRepo, "unstage-all")}
              >
                {#if bulkMutation === "unstage-all"}
                  <Spinner />
                {:else}
                  <ArrowDownToLine />
                {/if}
              </Button>
              <span class="ml-auto">{stagedFiles.length}</span>
            </div>
            {#each stagedFiles as file (file.path)}
              {@render changeRow(file, "staged")}
            {/each}
          </div>
        {/if}
        {#if unstagedFiles.length > 0}
          <div class="flex flex-col gap-0.5">
            <div
              class="flex h-5 items-center gap-1 px-1 text-xs font-medium text-muted-foreground"
            >
              <span>Unstaged</span>
              <Button
                size="icon-xs"
                class="size-5"
                variant="ghost"
                ariaLabel="Stage all"
                title="Stage all"
                disabled={!capabilities.bulkMutateFiles.enabled ||
                  Boolean(bulkMutation) ||
                  Boolean(fileMutation)}
                onclick={() => onBulkStage(selectedRepo, "stage-all")}
              >
                {#if bulkMutation === "stage-all"}
                  <Spinner />
                {:else}
                  <ArrowUpFromLine />
                {/if}
              </Button>
              <span class="ml-auto">{unstagedFiles.length}</span>
            </div>
            {#each unstagedFiles as file (file.path)}
              {@render changeRow(file, "unstaged")}
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    <!-- future: commit / create-branch / create-PR action bar (agentic) -->
  {:else}
    <div class="py-1 text-xs text-muted-foreground">Loading…</div>
  {/if}
</PanelSection>
