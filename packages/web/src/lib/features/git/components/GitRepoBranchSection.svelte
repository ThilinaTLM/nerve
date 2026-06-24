<script lang="ts">
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import CloudDownload from "@lucide/svelte/icons/cloud-download";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Search from "@lucide/svelte/icons/search";
  import type { GitBranchSummary, GitRepoSummary } from "$lib/api";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import * as Popover from "$lib/components/ui/popover";
  import { ToggleGroup, ToggleGroupItem } from "$lib/components/ui/toggle-group";
  import { cn } from "$lib/core/utils.js";
  import PanelSection from "$lib/app/layout/utility/PanelSection.svelte";
  import { repoPathLabel } from "./git-change-format";

  type Props = {
    repoSummary?: GitRepoSummary;
    repos: GitRepoSummary[];
    selectedRepo: string;
    filteredBranches: GitBranchSummary[];
    loadingBranches: boolean;
    switchingBranch?: string;
    creatingBranch: boolean;
    fetching: boolean;
    syncing: boolean;
    refreshing: boolean;
    branchFilter?: string;
    newBranchName?: string;
    branchPopoverOpen?: boolean;
    open?: boolean;
    onSelectRepo: (value: string) => void;
    onSwitchBranch: (repo: string, branch: GitBranchSummary) => void;
    onCreateBranch: (repo: string) => void;
    onFetch: (repo: string) => void;
    onSync: (repo: string) => void;
  };

  let {
    repoSummary,
    repos,
    selectedRepo,
    filteredBranches,
    loadingBranches,
    switchingBranch,
    creatingBranch,
    fetching,
    syncing,
    refreshing,
    branchFilter = $bindable(""),
    newBranchName = $bindable(""),
    branchPopoverOpen = $bindable(false),
    open = $bindable(true),
    onSelectRepo,
    onSwitchBranch,
    onCreateBranch,
    onFetch,
    onSync,
  }: Props = $props();
</script>

{#snippet repoRefreshActions()}
  {#if refreshing}
    <span
      class="inline-flex h-6 w-6 items-center justify-center text-muted-foreground"
      role="status"
      aria-label="Refreshing Git status"
      title="Refreshing Git status"
    >
      <LoaderCircle size={12} class="animate-spin" />
    </span>
  {/if}
{/snippet}

      <PanelSection title="Repo & Branch" icon={GitBranch} actions={repoRefreshActions} bind:open>
        {#if repoSummary}
          {@const repo = repoSummary}
          <div class="flex flex-col gap-2">
            {#if repos.length > 1}
              <ToggleGroup
                type="single"
                value={selectedRepo}
                variant="outline"
                size="sm"
                class="flex-wrap"
                onValueChange={(value) => {
                  if (value) onSelectRepo(value);
                }}
              >
                {#each repos as repo (repo.relativePath)}
                  <ToggleGroupItem
                    value={repo.relativePath}
                    aria-label={`Switch to ${repo.name}`}
                    title={repoPathLabel(repo)}
                    class="font-mono text-xs"
                  >
                    {repo.name}
                  </ToggleGroupItem>
                {/each}
              </ToggleGroup>
            {/if}

            <div class="flex items-center gap-2">
              <Popover.Root bind:open={branchPopoverOpen}>
                <Popover.Trigger
                  class={cn(
                    "inline-flex min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    repo.detached && "text-muted-foreground",
                  )}
                >
                  <GitBranch size={12} strokeWidth={2.2} class="shrink-0" />
                  <span class="truncate font-mono">{repo.currentBranch ?? "(detached)"}</span>
                  <ChevronDown size={12} strokeWidth={2.2} class="shrink-0 text-muted-foreground" />
                </Popover.Trigger>
                <Popover.Content align="start" collisionPadding={8} class="w-[min(360px,calc(100vw-2rem))] gap-3 p-3">
                  <div class="flex flex-col gap-0.5">
                    <div class="text-xs font-medium text-foreground">Switch branch</div>
                    <div class="text-xs text-muted-foreground">
                      Current: <span class="font-mono text-foreground">{repo.currentBranch ?? "detached"}</span>
                    </div>
                  </div>
                  <div class="relative">
                    <Search size={13} strokeWidth={2.1} class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input bind:value={branchFilter} placeholder="Filter branches" class="h-8 pl-7 text-xs" />
                  </div>
                  <div class="max-h-56 overflow-y-auto rounded-md border">
                    {#if loadingBranches}
                      <div class="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                        <LoaderCircle size={13} class="animate-spin" /> Loading branches…
                      </div>
                    {:else if filteredBranches.length === 0}
                      <div class="px-3 py-2 text-xs text-muted-foreground">No branches found.</div>
                    {:else}
                      {#each filteredBranches as branch (branch.name)}
                        <button
                          type="button"
                          class="flex w-full items-center gap-2 border-b px-2.5 py-1.5 text-left text-xs last:border-b-0 hover:bg-muted/60 disabled:opacity-60"
                          disabled={branch.current || switchingBranch === branch.name}
                          onclick={() => void onSwitchBranch(selectedRepo, branch)}
                        >
                          {#if switchingBranch === branch.name}
                            <LoaderCircle size={13} class="animate-spin text-muted-foreground" />
                          {:else if branch.current}
                            <Check size={13} class="text-success" />
                          {:else}
                            <GitBranch size={13} class="text-muted-foreground" />
                          {/if}
                          <span class="min-w-0 flex-1 truncate font-mono text-foreground">{branch.name}</span>
                          {#if branch.remote}
                            <Badge tone="neutral" size="xs">remote</Badge>
                          {/if}
                        </button>
                      {/each}
                    {/if}
                  </div>
                  <div class="flex flex-col gap-1.5 border-t pt-3">
                    <div class="text-xs font-medium text-foreground">Create from current</div>
                    <div class="flex gap-1.5">
                      <Input bind:value={newBranchName} placeholder="feature/branch-name" class="h-8 font-mono text-xs" />
                      <Button
                        size="sm"
                        disabled={creatingBranch || newBranchName.trim().length === 0}
                        onclick={() => void onCreateBranch(selectedRepo)}
                      >
                        {#if creatingBranch}
                          <LoaderCircle class="animate-spin" />
                        {:else}
                          <GitBranch />
                        {/if}
                        Create
                      </Button>
                    </div>
                  </div>
                </Popover.Content>
              </Popover.Root>

              {#if repo.hasRemote}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  ariaLabel="Fetch"
                  title="Fetch from remote"
                  disabled={fetching}
                  onclick={() => void onFetch(selectedRepo)}
                >
                  {#if fetching}
                    <LoaderCircle class="animate-spin" />
                  {:else}
                    <CloudDownload />
                  {/if}
                </Button>
              {/if}

              <div class="flex min-w-0 items-center gap-1 text-xs">
                {#if !repo.hasRemote}
                  <span class="text-muted-foreground">local only</span>
                {:else if !repo.hasUpstream}
                  <span class="text-muted-foreground">no upstream</span>
                {:else if (repo.ahead ?? 0) === 0 && (repo.behind ?? 0) === 0}
                  <span class="flex items-center gap-0.5 text-muted-foreground">
                    <Check size={12} strokeWidth={2.2} /> up to date
                  </span>
                {:else}
                  {#if (repo.ahead ?? 0) > 0}
                    <Button
                      size="xs"
                      variant="ghost"
                      class="gap-0.5 px-1.5 font-mono text-info"
                      title="Sync current branch with upstream"
                      ariaLabel={`Sync branch (${repo.ahead} commits to push)`}
                      disabled={syncing || repo.detached}
                      onclick={() => void onSync(selectedRepo)}
                    >
                      {#if syncing}
                        <LoaderCircle class="animate-spin" />
                      {:else}
                        <ArrowUp strokeWidth={2.4} />
                      {/if}
                      {repo.ahead}
                    </Button>
                  {/if}
                  {#if (repo.behind ?? 0) > 0}
                    <Button
                      size="xs"
                      variant="ghost"
                      class="gap-0.5 px-1.5 font-mono text-warning"
                      title="Sync current branch with upstream"
                      ariaLabel={`Sync branch (${repo.behind} commits to pull)`}
                      disabled={syncing || repo.detached}
                      onclick={() => void onSync(selectedRepo)}
                    >
                      {#if syncing}
                        <LoaderCircle class="animate-spin" />
                      {:else}
                        <ArrowDown strokeWidth={2.4} />
                      {/if}
                      {repo.behind}
                    </Button>
                  {/if}
                {/if}
                {#if repo.detached}
                  <Badge tone="warn" size="xs">detached</Badge>
                {/if}
              </div>
            </div>
          </div>
        {:else}
          <div class="py-1 text-xs text-muted-foreground">Loading…</div>
        {/if}
      </PanelSection>
