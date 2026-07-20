<script lang="ts">
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import CloudDownload from "@lucide/svelte/icons/cloud-download";
import GitBranch from "@lucide/svelte/icons/git-branch";
import GitCompareArrows from "@lucide/svelte/icons/git-compare-arrows";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import type { GitBranchSummary, GitRepoSummary } from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@nervekit/ui-kit/components/ui/toggle-group";
import { cn } from "@nervekit/ui-kit/core/utils";
import { PanelSection } from "@nervekit/workbench-ui/components/workbench";
import { repoButtonLabel, repoPathLabel } from "./git-change-format";
import {
  basePullDisabled,
  pullDisabled,
  pushDisabled,
  remoteActionDisabled,
  showPull,
  showPush,
  syncDisabled,
} from "./git-remote-actions";
import type { GitPanelCapabilities } from "./git-panel-types";
import GitBranchDialog from "./GitBranchDialog.svelte";

type Props = {
  repoSummary?: GitRepoSummary;
  repos: GitRepoSummary[];
  selectedRepo: string;
  filteredBranches: GitBranchSummary[];
  loadingBranches: boolean;
  switchingBranch?: string;
  creatingBranch: boolean;
  fetching: boolean;
  pulling: boolean;
  pushing: boolean;
  syncing: boolean;
  switchingBaseAndPulling: boolean;
  refreshing: boolean;
  capabilities: GitPanelCapabilities;
  branchFilter?: string;
  newBranchName?: string;
  branchDialogOpen?: boolean;
  baseBranchSummary?: GitBranchSummary;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelectRepo: (value: string) => void;
  onOpenBranchDialog: () => void;
  onSwitchBranch: (repo: string, branch: GitBranchSummary) => void;
  onCreateBranch: (repo: string) => void;
  onFetch: (repo: string) => void;
  onPull: (repo: string) => void;
  onPush: (repo: string) => void;
  onSync: (repo: string) => void;
  onSwitchBaseAndPull: (repo: string) => void;
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
  pulling,
  pushing,
  syncing,
  switchingBaseAndPulling,
  refreshing,
  capabilities,
  branchFilter = $bindable(""),
  newBranchName = $bindable(""),
  branchDialogOpen = $bindable(false),
  baseBranchSummary,
  open = $bindable(true),
  onOpenChange,
  onSelectRepo,
  onOpenBranchDialog,
  onSwitchBranch,
  onCreateBranch,
  onFetch,
  onPull,
  onPush,
  onSync,
  onSwitchBaseAndPull,
}: Props = $props();

const remoteActionInProgress = $derived(
  fetching || pulling || pushing || syncing || switchingBaseAndPulling,
);

function showBasePull(repo: GitRepoSummary): boolean {
  return !repo.detached && !repo.onBaseBranch;
}
</script>

{#snippet repoRefreshActions()}
  {#if refreshing}
    <span
      class="inline-flex h-6 w-6 items-center justify-center text-muted-foreground"
      role="status"
      aria-label="Refreshing Git status"
      title="Refreshing Git status"
    >
      <Spinner class="size-3" />
    </span>
  {/if}
{/snippet}

<PanelSection
  title="Repo & Branch"
  icon={GitBranch}
  actions={repoRefreshActions}
  bind:open
  {onOpenChange}
>
  {#if repoSummary}
    {@const repo = repoSummary}
    <div class="flex flex-col gap-2.5">
      {#if repos.length > 1}
        <div class="flex flex-col gap-1">
          <ToggleGroup
            type="single"
            value={selectedRepo}
            variant="outline"
            size="sm"
            spacing={1}
            class="flex w-full flex-wrap items-start gap-1"
            onValueChange={(value) => {
              if (value) onSelectRepo(value);
            }}
          >
            {#each repos as candidate (candidate.relativePath)}
              <ToggleGroupItem
                value={candidate.relativePath}
                disabled={!capabilities.selectRepository.enabled}
                aria-label={`Switch to ${repoPathLabel(candidate)}`}
                title={repoPathLabel(candidate)}
                class="h-6 max-w-28 min-w-0 rounded-md px-2 text-xs data-[state=on]:border-primary/40 data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
              >
                <span class="block truncate font-mono"
                  >{repoButtonLabel(candidate, repos)}</span
                >
              </ToggleGroupItem>
            {/each}
          </ToggleGroup>
        </div>
      {/if}

      <button
        type="button"
        disabled={!capabilities.branches.enabled}
        title={capabilities.branches.enabled
          ? "Switch or create a branch"
          : capabilities.branches.reason}
        class={cn(
          "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
          repo.detached && "text-muted-foreground",
        )}
        onclick={() => onOpenBranchDialog()}
      >
        <GitBranch size={12} strokeWidth={2.2} class="shrink-0" />
        <span class="truncate font-mono"
          >{repo.currentBranch ?? "(detached)"}</span
        >
        <ChevronDown
          size={12}
          strokeWidth={2.2}
          class="shrink-0 text-muted-foreground"
        />
      </button>

      <GitBranchDialog
        bind:open={branchDialogOpen}
        repoSummary={repo}
        {selectedRepo}
        {filteredBranches}
        {baseBranchSummary}
        {loadingBranches}
        {switchingBranch}
        {creatingBranch}
        branchesEnabled={capabilities.branches.enabled}
        bind:branchFilter
        bind:newBranchName
        {onSwitchBranch}
        {onCreateBranch}
      />

      <div class="flex flex-col gap-1">
        <div class="flex flex-wrap items-center gap-1">
          <Button
            size="xs"
            variant="outline"
            ariaLabel="Fetch from remote"
            title={repo.hasRemote
              ? "Fetch from remote and prune deleted refs"
              : "Add a remote before fetching"}
            disabled={!capabilities.remote.fetch.enabled ||
              remoteActionDisabled(repo, remoteActionInProgress)}
            onclick={() => void onFetch(selectedRepo)}
          >
            {#if fetching}
              <Spinner class="size-3" />
            {:else}
              <CloudDownload />
            {/if}
            Fetch
          </Button>
          {#if showPull(repo)}
            <Button
              size="xs"
              variant="outline"
              ariaLabel="Pull current branch"
              title={repo.dirty
                ? "Commit or stash changes before pulling"
                : "Pull current branch with fast-forward only"}
              disabled={!capabilities.remote.pull.enabled ||
                pullDisabled(repo, remoteActionInProgress)}
              onclick={() => void onPull(selectedRepo)}
            >
              {#if pulling}
                <Spinner class="size-3" />
              {:else}
                <ArrowDown />
              {/if}
              {#if (repo.behind ?? 0) > 0}<span class="font-mono tabular-nums"
                  >{repo.behind}</span
                >{/if}
              Pull
            </Button>
          {/if}
          {#if showPush(repo)}
            <Button
              size="xs"
              variant="outline"
              ariaLabel="Push current branch"
              title="Push current branch"
              disabled={!capabilities.remote.push.enabled ||
                pushDisabled(repo, remoteActionInProgress)}
              onclick={() => void onPush(selectedRepo)}
            >
              {#if pushing}
                <Spinner class="size-3" />
              {:else}
                <ArrowUp />
              {/if}
              {#if (repo.ahead ?? 0) > 0}<span class="font-mono tabular-nums"
                  >{repo.ahead}</span
                >{/if}
              Push
            </Button>
          {/if}
          <Button
            size="xs"
            variant="outline"
            ariaLabel="Sync current branch"
            title={!repo.hasRemote
              ? "Add a remote before syncing"
              : repo.detached
                ? "Check out a branch before syncing"
                : "Fetch, then pull and push the current branch when needed"}
            disabled={!capabilities.remote.sync.enabled ||
              syncDisabled(repo, remoteActionInProgress)}
            onclick={() => void onSync(selectedRepo)}
          >
            {#if syncing}
              <Spinner class="size-3" />
            {:else}
              <RefreshCw />
            {/if}
            Sync
          </Button>
          {#if showBasePull(repo)}
            <Button
              size="xs"
              variant="outline"
              ariaLabel={`Switch to ${repo.baseBranch} and pull`}
              title={repo.dirty
                ? "Commit or stash changes before switching branches"
                : `Switch to ${repo.baseBranch} and pull with fast-forward only`}
              disabled={!capabilities.remote["switch-base-and-pull"].enabled ||
                basePullDisabled(repo, remoteActionInProgress)}
              onclick={() => void onSwitchBaseAndPull(selectedRepo)}
            >
              {#if switchingBaseAndPulling}
                <Spinner class="size-3" />
              {:else}
                <GitCompareArrows />
              {/if}
              <span class="font-mono">{repo.baseBranch}</span>
              + pull
            </Button>
          {/if}
        </div>
        {#if !repo.hasRemote}
          <div
            class="rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground"
          >
            Remote actions are unavailable for local-only repositories.
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="py-1 text-xs text-muted-foreground">Loading…</div>
  {/if}
</PanelSection>
