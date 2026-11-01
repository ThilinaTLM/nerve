<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import GitBranch from "@lucide/svelte/icons/git-branch";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { GitBranchSummary } from "@nervekit/contracts/git";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { cn } from "@nervekit/ui-kit/utils";
import {
  canDeleteBranch,
  type GitBranchDialogRow,
} from "./git-panel-controller";

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
const canDelete = $derived(enabled && canDeleteBranch(branch, baseBranch));
const busy = $derived(switching || deleting);
const showActions = $derived(!branch.current && !busy);
</script>

<div
  role="listitem"
  class={cn(
    "group/row relative flex h-8 min-w-0 items-center gap-2 rounded-md px-1.5 hover:bg-hover focus-within:bg-hover",
    branch.current && "bg-selected hover:bg-selected",
  )}
>
  <button
    type="button"
    class="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-focus disabled:cursor-default"
    disabled={!enabled || branch.current || busy}
    aria-label={branch.current
      ? `${branch.name}, current branch`
      : `Switch to ${branch.name}`}
    onclick={() => onSwitch(branch)}
  >
    {#if switching}
      <Spinner class="size-3.5 shrink-0 text-muted-foreground" />
    {:else if branch.current}
      <Check class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
    {:else}
      <GitBranch
        class="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    {/if}
    <span class="min-w-0 truncate text-ui text-foreground">{branch.name}</span>
    {#if isBase}<Badge variant="info">base</Badge>{/if}
  </button>

  {#if row.pullRequest}
    <Badge
      variant="brand"
      title={`Open pull request #${row.pullRequest.number}${row.pullRequest.isDraft ? " (draft)" : ""}`}
      aria-label={`Open pull request #${row.pullRequest.number}`}
      onclick={() => onOpenPullRequest(row.pullRequest!.number)}
    >
      <GitPullRequest aria-hidden="true" />#{row.pullRequest.number}{row
        .pullRequest.isDraft
        ? " draft"
        : ""}
    </Badge>
  {/if}

  <div class="flex shrink-0 items-center justify-end gap-1">
    {#if deleting}
      <span
        class="flex size-control-sm items-center justify-center"
        title="Deleting branch"
      >
        <Spinner class="size-3.5 text-muted-foreground" />
      </span>
    {:else}
      <span
        class={cn(
          "text-ui text-muted-foreground",
          showActions && "group-hover/row:hidden group-focus-within/row:hidden",
        )}
        title={branch.updatedAt ?? undefined}>{row.updatedLabel}</span
      >
      {#if showActions}
        <div
          class="hidden items-center gap-1 group-hover/row:flex group-focus-within/row:flex"
        >
          <Button
            variant="outline"
            size="sm"
            disabled={!enabled}
            ariaLabel={`Switch to ${branch.name}`}
            onclick={() => onSwitch(branch)}>Switch</Button
          >
          {#if canDelete}
            <IconAction
              icon={Trash2}
              tone="destructive"
              label="Delete branch"
              onclick={() => onDelete(branch)}
            />
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>
