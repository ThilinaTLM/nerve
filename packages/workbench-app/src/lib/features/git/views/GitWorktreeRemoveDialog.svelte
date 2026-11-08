<script lang="ts">
import type { GitRepoSummary } from "@nervekit/contracts/git";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import FormDialog from "@nervekit/ui-kit/components/composites/form-dialog";
import SwitchField from "@nervekit/ui-kit/components/composites/switch-field";

type Props = {
  open?: boolean;
  /** The linked worktree to remove. */
  target?: GitRepoSummary;
  busy?: boolean;
  onSubmit: (options: {
    force: boolean;
    deleteBranch: boolean;
  }) => boolean | Promise<boolean>;
};

let {
  open = $bindable(false),
  target,
  busy = false,
  onSubmit,
}: Props = $props();

let deleteBranch = $state(false);
let pending = $state(false);
let wasOpen = false;
$effect(() => {
  if (open && !wasOpen) deleteBranch = false;
  wasOpen = open;
});

const dirty = $derived((target?.changeCount ?? 0) > 0);
/** The base branch is never deleted. */
const branchName = $derived(
  target?.currentBranch && target.currentBranch !== target.baseBranch
    ? target.currentBranch
    : undefined,
);

async function submit(): Promise<void> {
  pending = true;
  try {
    const removed = await onSubmit({
      force: dirty,
      deleteBranch: Boolean(branchName) && deleteBranch,
    });
    if (removed) open = false;
  } finally {
    pending = false;
  }
}
</script>

<FormDialog
  bind:open
  title="Remove worktree?"
  description={target
    ? `Removes the folder ${target.absDir} and its checkout of ${target.currentBranch ?? "a detached HEAD"}. Commits on the branch are kept.`
    : undefined}
  submitLabel={dirty ? "Discard changes and remove" : "Remove worktree"}
  submitVariant="destructive"
  busy={busy || pending}
  bodyClass="gap-3"
  onSubmit={submit}
>
  {#if target && dirty}
    <Callout
      tone="destructive"
      icon={CircleAlert}
      text={`${target.changeCount} uncommitted ${target.changeCount === 1 ? "change" : "changes"} will be lost.`}
    />
  {/if}
  {#if target && branchName}
    <SwitchField
      bind:checked={deleteBranch}
      label={`Also delete branch ${branchName}`}
      description={target.mergedToBase
        ? `Merged into ${target.baseBranch}.`
        : `Not merged into ${target.baseBranch}; its commits will be lost.`}
    />
  {/if}
</FormDialog>
