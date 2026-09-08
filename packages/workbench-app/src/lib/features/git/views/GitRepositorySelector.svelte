<script lang="ts">
import type { GitBranchSummary, GitRepoSummary } from "@nervekit/contracts/git";
import type { GitBranchDialogRow } from "./git-panel-controller";
import type { FeatureCapability } from "./git-panel-types";
import GitRepoBranchRow from "./GitRepoBranchRow.svelte";

type Props = {
  repos: GitRepoSummary[];
  selectedRepo: string;
  selectCapability: FeatureCapability;
  onSelectRepo: (repository: string) => void;
  /** Omitted by surfaces that only choose a repository, such as the PR panel. */
  branches?: {
    readonly capability: FeatureCapability;
    readonly rowsFor: (repository: string) => readonly GitBranchDialogRow[];
    readonly loadingFor: (repository: string) => boolean;
    readonly switchingFor: (repository: string) => string | undefined;
    readonly onLoad: (repository: string) => void;
    readonly onSwitch: (repository: string, branch: GitBranchSummary) => void;
    readonly onManage: (repository: string) => void;
    readonly onCreate: (repository: string) => void;
  };
};

let { repos, selectedRepo, selectCapability, onSelectRepo, branches }: Props =
  $props();

/* With a single repository there is nothing to choose between, so the
 * selection tint would be noise rather than information. */
const selectable = $derived(repos.length > 1);
</script>

<div class="flex w-full min-w-0 flex-col gap-0.5">
  {#each repos as repo (repo.relativePath)}
    <GitRepoBranchRow
      {repo}
      {repos}
      selected={selectable && repo.relativePath === selectedRepo}
      selectEnabled={selectable && selectCapability.enabled}
      {onSelectRepo}
      branchPicker={branches
        ? {
            rows: branches.rowsFor(repo.relativePath),
            loading: branches.loadingFor(repo.relativePath),
            enabled: branches.capability.enabled,
            switchingBranch: branches.switchingFor(repo.relativePath),
            onLoad: branches.onLoad,
            onSwitch: branches.onSwitch,
            onManage: branches.onManage,
            onCreate: branches.onCreate,
          }
        : undefined}
    />
  {/each}
</div>
