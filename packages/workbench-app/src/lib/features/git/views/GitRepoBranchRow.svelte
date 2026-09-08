<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import Folder from "@lucide/svelte/icons/folder";
import GitBranch from "@lucide/svelte/icons/git-branch";
import type { GitBranchSummary, GitRepoSummary } from "@nervekit/contracts/git";
import type { GitBranchDialogRow } from "./git-panel-controller";
import { repoButtonLabel, repoPathLabel } from "./git-change-format";
import GitBranchPopover from "./GitBranchPopover.svelte";

type Props = {
  repo: GitRepoSummary;
  repos: GitRepoSummary[];
  selected: boolean;
  selectEnabled: boolean;
  onSelectRepo: (repository: string) => void;
  /** Branch picking is optional; surfaces without it show the repo only. */
  branchPicker?: {
    readonly rows: readonly GitBranchDialogRow[];
    readonly loading: boolean;
    readonly enabled: boolean;
    readonly switchingBranch?: string;
    readonly onLoad: (repository: string) => void;
    readonly onSwitch: (repository: string, branch: GitBranchSummary) => void;
    readonly onManage: (repository: string) => void;
    readonly onCreate: (repository: string) => void;
  };
};

let {
  repo,
  repos,
  selected,
  selectEnabled,
  onSelectRepo,
  branchPicker,
}: Props = $props();

/* Open state and filter live per row, so they can never leak between repos. */
let branchesOpen = $state(false);
let branchFilter = $state("");

const branchLabel = $derived(repo.currentBranch ?? "(detached)");

/* Each segment paints its own hover fill so the two targets are visibly
 * separate: the name selects the repository, the branch opens the picker. */
const segmentClass =
  "flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";
</script>

<div
  class={`flex min-w-0 items-center rounded-md p-0.5 transition-colors ${
    selected ? "bg-primary/15" : "hover:bg-accent/40"
  }`}
>
  <button
    type="button"
    disabled={!selectEnabled}
    aria-current={selected ? "true" : undefined}
    aria-label={`Switch to ${repoPathLabel(repo)}`}
    title={`Switch to ${repoPathLabel(repo)}`}
    class={`${segmentClass} shrink-0 hover:bg-accent/70 ${
      selected ? "font-medium text-foreground" : "text-muted-foreground"
    }`}
    onclick={() => onSelectRepo(repo.relativePath)}
  >
    <Folder class="size-3 shrink-0" aria-hidden="true" />
    <span class="truncate font-mono">{repoButtonLabel(repo, repos)}</span>
  </button>

  {#if branchPicker}
    {@const picker = branchPicker}
    <span class="shrink-0 text-xs text-muted-foreground/55" aria-hidden="true"
      >/</span
    >

    <GitBranchPopover
      {repo}
      rows={picker.rows}
      bind:open={branchesOpen}
      bind:filter={branchFilter}
      loading={picker.loading}
      enabled={picker.enabled}
      switchingBranch={picker.switchingBranch}
      triggerClass={`${segmentClass} min-w-0 flex-1 hover:bg-accent/70 ${
        repo.detached ? "text-muted-foreground" : "text-foreground"
      }`}
      triggerTitle={`Switch branch in ${repoPathLabel(repo)}`}
      onOpen={() => picker.onLoad(repo.relativePath)}
      onSwitch={(branch) => picker.onSwitch(repo.relativePath, branch)}
      onManage={() => picker.onManage(repo.relativePath)}
      onCreate={() => picker.onCreate(repo.relativePath)}
    >
      {#snippet triggerContent()}
        <GitBranch class="size-3 shrink-0" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-left font-mono"
          >{branchLabel}</span
        >
        <ChevronDown
          class="size-3 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      {/snippet}
    </GitBranchPopover>
  {/if}
</div>
