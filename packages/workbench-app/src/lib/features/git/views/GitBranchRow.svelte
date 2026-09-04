<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import GitBranch from "@lucide/svelte/icons/git-branch";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { GitBranchSummary } from "@nervekit/contracts/git";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import type { GitBranchDialogRow } from "./git-panel-controller";

type Props = {
  row: GitBranchDialogRow;
  baseBranch?: string;
  enabled: boolean;
  switching: boolean;
  deleting: boolean;
  onSwitch: (branch: GitBranchSummary) => void;
  onDelete: (branch: GitBranchSummary) => void;
  onOpenPullRequest: (number: number) => void;
};

let {
  row,
  baseBranch,
  enabled,
  switching,
  deleting,
  onSwitch,
  onDelete,
  onOpenPullRequest,
}: Props = $props();

const branch = $derived(row.branch);
const isBase = $derived(!branch.remote && branch.name === baseBranch);
const canDelete = $derived(
  enabled && !branch.remote && !branch.current && !isBase,
);
</script>

<div
  class="group flex min-w-0 items-center border-b last:border-b-0 hover:bg-muted/50"
>
  <button
    type="button"
    class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-1.5 text-left disabled:cursor-default"
    disabled={!enabled || branch.current || switching || deleting}
    aria-label={branch.current
      ? `${branch.name}, current branch`
      : `Switch to ${branch.name}`}
    onclick={() => onSwitch(branch)}
  >
    {#if switching}
      <Spinner class="size-3.5 text-muted-foreground" />
    {:else if branch.current}
      <Check class="size-3.5 text-success" aria-hidden="true" />
    {:else}
      <GitBranch class="size-3.5 text-muted-foreground" aria-hidden="true" />
    {/if}
    <span class="flex min-w-0 flex-1 items-center gap-2">
      <span class="truncate font-mono text-xs text-foreground"
        >{branch.name}</span
      >
      <span
        class="shrink-0 text-xs text-muted-foreground"
        title={branch.updatedAt ?? undefined}>{row.updatedLabel}</span
      >
    </span>
  </button>

  <div class="flex shrink-0 items-center gap-1 pr-2">
    {#if branch.current}
      <Badge tone="good" size="xs">current</Badge>
    {/if}
    {#if isBase}
      <Badge tone="running" size="xs">base</Badge>
    {/if}
    {#if row.pullRequest}
      <Button
        variant="link"
        size="xs"
        class="h-5 px-1"
        title={`Open pull request #${row.pullRequest.number}${row.pullRequest.isDraft ? " (draft)" : ""}`}
        ariaLabel={`Open pull request #${row.pullRequest.number}`}
        onclick={() => onOpenPullRequest(row.pullRequest!.number)}
      >
        <GitPullRequest class="size-3" aria-hidden="true" />
        #{row.pullRequest.number}{row.pullRequest.isDraft ? " draft" : ""}
      </Button>
    {/if}
    {#if deleting}
      <span
        class="flex size-6 items-center justify-center"
        title="Deleting branch"
      >
        <Spinner class="size-3.5 text-muted-foreground" />
      </span>
    {:else}
      <Button
        variant="ghost"
        size="icon-xs"
        class="text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={!canDelete}
        ariaLabel={`Delete branch ${branch.name}`}
        title={branch.remote
          ? "Remote branches cannot be deleted here"
          : branch.current
            ? "Switch branches before deleting"
            : isBase
              ? "The base branch cannot be deleted"
              : "Delete branch"}
        onclick={() => onDelete(branch)}
      >
        <Trash2 class="size-3.5" aria-hidden="true" />
      </Button>
    {/if}
  </div>
</div>
