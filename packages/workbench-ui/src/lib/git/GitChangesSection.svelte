<script lang="ts">
  import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
  import ArrowUpFromLine from "@lucide/svelte/icons/arrow-up-from-line";
  import FilePen from "@lucide/svelte/icons/file-pen";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import X from "@lucide/svelte/icons/x";
  import type { GitFileChange } from "@nervekit/contracts";
  import { Button } from "@nervekit/workbench-ui/components/ui/button";
  import { cn } from "@nervekit/workbench-ui/core/utils";
  import { PanelSection } from "@nervekit/workbench-ui/components/workbench";
  import type { FileMutation } from "./git-panel-types";
  import {
    fileStatusLabel,
    fileTone,
    shortenPath,
    splitPath,
    statusLetter,
  } from "./git-change-format";

  type ChangesState = {
    files: GitFileChange[];
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
    open?: boolean;
    onMutateFile: (
      repo: string,
      file: GitFileChange,
      action: "stage" | "unstage" | "discard",
    ) => void;
    onBulkStage: (repo: string, action: "stage-all" | "unstage-all") => void;
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
    open = $bindable(true),
    onMutateFile,
    onBulkStage,
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
      {#if parts.dir}<span class="text-muted-foreground">{parts.dir}</span>{/if}<span class="text-foreground">{parts.base}</span>
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
          disabled={busy}
          onclick={() => onMutateFile(selectedRepo, file, "unstage")}
        >
          {#if busy && fileMutation?.action === "unstage"}
            <LoaderCircle class="animate-spin" />
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
          disabled={busy}
          onclick={() => onMutateFile(selectedRepo, file, "stage")}
        >
          {#if busy && fileMutation?.action === "stage"}
            <LoaderCircle class="animate-spin" />
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
        disabled={busy}
        onclick={() => onRequestDiscard(file)}
      >
        {#if busy && fileMutation?.action === "discard"}
          <LoaderCircle class="animate-spin" />
        {:else}
          <X />
        {/if}
      </Button>
    </div>
  </div>
{/snippet}

<PanelSection title="Changes" icon={FilePen} contentClass="px-2 py-1.5" bind:open>
  {#snippet meta()}
    {#if changes}
      <span>{changes.stagedCount} staged</span>
      <span class="text-muted-foreground/50">·</span>
      <span>{changes.unstagedCount + changes.untrackedCount} unstaged</span>
    {/if}
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
            <div class="flex h-5 items-center gap-1 px-1 text-xs font-medium text-muted-foreground">
              <span>Staged</span>
              <Button
                size="icon-xs"
                class="size-5"
                variant="ghost"
                ariaLabel="Unstage all"
                title="Unstage all"
                disabled={Boolean(bulkMutation) || Boolean(fileMutation)}
                onclick={() => onBulkStage(selectedRepo, "unstage-all")}
              >
                {#if bulkMutation === "unstage-all"}
                  <LoaderCircle class="animate-spin" />
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
            <div class="flex h-5 items-center gap-1 px-1 text-xs font-medium text-muted-foreground">
              <span>Unstaged</span>
              <Button
                size="icon-xs"
                class="size-5"
                variant="ghost"
                ariaLabel="Stage all"
                title="Stage all"
                disabled={Boolean(bulkMutation) || Boolean(fileMutation)}
                onclick={() => onBulkStage(selectedRepo, "stage-all")}
              >
                {#if bulkMutation === "stage-all"}
                  <LoaderCircle class="animate-spin" />
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
