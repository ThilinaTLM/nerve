<script lang="ts">
import type { Snippet } from "svelte";
import GitBranch from "@lucide/svelte/icons/git-branch";
import Plus from "@lucide/svelte/icons/plus";
import Settings2 from "@lucide/svelte/icons/settings-2";
import type { GitBranchSummary, GitRepoSummary } from "@nervekit/contracts/git";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import PopoverPanel, {
  PopoverCommandList,
  PopoverFooter,
  PopoverHeader,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import type { GitBranchDialogRow } from "./git-panel-controller";
import { repoPathLabel } from "./git-change-format";

type Props = {
  repo: GitRepoSummary;
  rows: readonly GitBranchDialogRow[];
  open?: boolean;
  loading: boolean;
  enabled: boolean;
  switchingBranch?: string;
  onOpen: () => void;
  onSwitch: (branch: GitBranchSummary) => void;
  onManage: () => void;
  onCreate: () => void;
  triggerContent: Snippet;
  triggerClass?: string;
  triggerTitle?: string;
};

let {
  repo,
  rows,
  open = $bindable(false),
  loading,
  enabled,
  switchingBranch,
  onOpen,
  onSwitch,
  onManage,
  onCreate,
  triggerContent,
  triggerClass,
  triggerTitle,
}: Props = $props();

// Keep the upstream rows unfiltered: the command list also searches group names.
let query = $state("");
const commandItems = $derived(
  rows.map((row) => ({
    ...row,
    key: row.branch.name,
    label: row.branch.name,
    group: row.branch.remote ? "Remote" : "Local",
    keywords: [
      row.branch.upstream ?? "",
      row.pullRequest ? `#${row.pullRequest.number}` : "",
      row.branch.current ? "current" : "",
      !row.branch.remote && row.branch.name === repo.baseBranch ? "base" : "",
    ],
  })),
);

function handleOpenChange(next: boolean): void {
  query = "";
  if (next) onOpen();
}

function choose(branch: GitBranchSummary): void {
  if (branch.current) return;
  onSwitch(branch);
  open = false;
}
</script>

<PopoverPanel
  bind:open
  size="md"
  align="start"
  {triggerClass}
  {triggerTitle}
  trigger={triggerContent}
  ariaLabel={`Switch branch in ${repoPathLabel(repo)}`}
  onOpenChange={handleOpenChange}
>
  <PopoverHeader title="Branches" meta={`${rows.length}`} />

  <PopoverCommandList
    items={commandItems}
    bind:query
    placeholder="Search branches"
    ariaLabel={`Branches in ${repoPathLabel(repo)}`}
    isSelected={(row) => row.branch.current}
    isDisabled={(row) =>
      !enabled || row.branch.current || Boolean(switchingBranch)}
    onChoose={(row) => choose(row.branch)}
    empty={loading
      ? "Loading branches…"
      : query.trim()
        ? "No branches match your search."
        : "No branches yet."}
  >
    {#snippet row(row)}
      {@const branch = row.branch}
      {@const switching = switchingBranch === branch.name}
      <span class="flex min-w-0 items-center gap-2">
        {#if switching}
          <Spinner class="size-3.5 shrink-0 text-muted-foreground" />
        {:else}
          <GitBranch
            class="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        {/if}
        <span class="min-w-0 flex-1 truncate">{branch.name}</span>
        {#if !branch.remote && branch.name === repo.baseBranch && !branch.current}
          <Badge variant="info" class="shrink-0">base</Badge>
        {/if}
        <span class="shrink-0 text-ui text-muted-foreground">
          {row.updatedLabel.replace(/^Updated /, "")}
        </span>
      </span>
    {/snippet}
  </PopoverCommandList>

  <PopoverFooter>
    <Button
      variant="ghost"
      size="sm"
      class="justify-start text-muted-foreground"
      disabled={!enabled}
      onclick={() => {
        open = false;
        onCreate();
      }}
    >
      <Plus aria-hidden="true" />
      New branch
    </Button>
    <Button
      variant="ghost"
      size="sm"
      class="justify-start text-muted-foreground"
      disabled={!enabled}
      onclick={() => {
        open = false;
        onManage();
      }}
    >
      <Settings2 aria-hidden="true" />
      All branches
    </Button>
  </PopoverFooter>
</PopoverPanel>
