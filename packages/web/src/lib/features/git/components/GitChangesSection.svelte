<script lang="ts">
  import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
  import ArrowUpFromLine from "@lucide/svelte/icons/arrow-up-from-line";
  import FilePen from "@lucide/svelte/icons/file-pen";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import X from "@lucide/svelte/icons/x";
  import type { GitFileChange } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/core/utils.js";
  import PanelSection from "$lib/app/layout/utility/PanelSection.svelte";
  import type { FileMutation } from "$lib/features/git/state/git-panel.svelte";
  import {
    fileStatusLabel,
    fileTone,
    shortenPath,
    splitPath,
    statusLetter,
  } from "./git-change-format";

  type Overview = {
    files: GitFileChange[];
    stagedCount: number;
    unstagedCount: number;
    untrackedCount: number;
  };

  type Props = {
    overview?: Overview;
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
    overview,
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
  <div class="group flex items-center gap-1.5 rounded-sm px-1.5 py-0 hover:bg-muted/40">
    <span
      class={cn(
        "w-3 shrink-0 text-center font-mono text-xs font-semibold leading-5",
        fileTone(file),
      )}
      title={fileStatusLabel(file, group)}
    >
      {statusLetter(file, group)}
    </span>
    <div class="min-w-0 flex-1 truncate font-mono text-xs leading-5" title={file.path}>
      {#if parts.dir}<span class="text-muted-foreground">{parts.dir}</span>{/if}<span class="text-foreground">{parts.base}</span>
    </div>
    <div
      class="flex w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 transition-all group-hover:w-auto group-hover:opacity-100 focus-within:w-auto focus-within:opacity-100"
    >
      {#if group === "staged"}
        <Button
          size="icon-xs"
          class="size-5"
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
          class="size-5"
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
        class="size-5"
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

<PanelSection title="Changes" icon={FilePen} bind:open>
  {#snippet meta()}
    {#if overview}
      <span>{overview.stagedCount} staged</span>
      <span class="text-muted-foreground/50">·</span>
      <span>{overview.unstagedCount + overview.untrackedCount} unstaged</span>
    {/if}
  {/snippet}

  {#if loadingOverview && !overview}
    <div class="py-1 text-xs text-muted-foreground">Loading…</div>
  {:else if overview}
    {#if overview.files.length === 0}
      <p class="py-1 text-xs text-muted-foreground">Working tree clean.</p>
    {:else}
      <div class="flex flex-col gap-1.5">
        {#if stagedFiles.length > 0}
          <div class="flex flex-col">
            <div class="flex items-center gap-1 px-1.5 py-px text-xs font-medium text-muted-foreground">
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
          <div class="flex flex-col">
            <div class="flex items-center gap-1 px-1.5 py-px text-xs font-medium text-muted-foreground">
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
