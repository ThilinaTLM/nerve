<script lang="ts">
import {
  isValidWorktreeId,
  uniqueWorktreeId,
  worktreeIdFromBranch,
  WORKTREES_DIRECTORY,
} from "@nervekit/contracts/git";
import FormDialog from "@nervekit/ui-kit/components/composites/form-dialog";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import {
  checkedOutElsewhere,
  worktreeFolder,
  type GitRepoGroup,
} from "./git-repo-tree";

type Props = {
  open?: boolean;
  /** The repository the worktree is added to. */
  group?: GitRepoGroup;
  /** More than one repository in the project: ids carry the repository name. */
  multiRepo: boolean;
  initialBranch?: string;
  busy?: boolean;
  onSubmit: (branch: string, id?: string) => boolean | Promise<boolean>;
};

let {
  open = $bindable(false),
  group,
  multiRepo,
  initialBranch = "",
  busy = false,
  onSubmit,
}: Props = $props();

const fieldId = $props.id();
let branch = $state("");
let id = $state("");
let pending = $state(false);
let wasOpen = false;
$effect(() => {
  if (open && !wasOpen) {
    branch = initialBranch;
    id = "";
  }
  wasOpen = open;
});

const primary = $derived(group?.primary);
/** The project folder: the primary checkout's directory minus its project-relative path. */
const projectDir = $derived.by(() => {
  if (!primary) return "";
  return primary.relativePath === "."
    ? primary.absDir
    : primary.absDir.slice(0, -primary.relativePath.length - 1);
});
const takenFolders = $derived(
  new Set((group?.repos ?? []).map((repo) => worktreeFolder(repo))),
);
const trimmedBranch = $derived(branch.trim());
const defaultId = $derived(
  primary && trimmedBranch
    ? uniqueWorktreeId(
        worktreeIdFromBranch(trimmedBranch, {
          repoName: primary.name,
          multiRepo,
        }),
        takenFolders,
      )
    : "",
);
const typedId = $derived(id.trim());
const effectiveId = $derived(typedId || defaultId);
const checkedOutIn = $derived(checkedOutElsewhere(group).get(trimmedBranch));
const problem = $derived.by(() => {
  if (!trimmedBranch) return undefined;
  if (checkedOutIn)
    return `${trimmedBranch} is already checked out in ${checkedOutIn}.`;
  if (typedId && !isValidWorktreeId(typedId))
    return "Worktree ID may use lowercase letters, digits, dots, dashes and underscores.";
  if (typedId && takenFolders.has(typedId))
    return `A worktree folder named ${typedId} already exists.`;
  if (!isValidWorktreeId(effectiveId))
    return "Enter a worktree ID: the branch name has no usable characters.";
  return undefined;
});
const preview = $derived(
  `${projectDir}/${WORKTREES_DIRECTORY}/${effectiveId || "…"}`,
);

async function submit(): Promise<void> {
  pending = true;
  try {
    if (await onSubmit(trimmedBranch, typedId || undefined)) open = false;
  } finally {
    pending = false;
  }
}
</script>

<FormDialog
  bind:open
  title="New worktree"
  description={primary ? `A separate checkout of ${primary.name}.` : undefined}
  submitLabel="Create worktree"
  submitDisabled={!trimmedBranch || Boolean(problem)}
  busy={busy || pending}
  bodyClass="gap-3"
  onSubmit={submit}
>
  <div class="grid gap-1.5">
    <Label for={`${fieldId}-branch`}>Branch</Label>
    <Input
      id={`${fieldId}-branch`}
      bind:value={branch}
      placeholder="Existing or new branch name"
      autocomplete="off"
    />
    <p class="text-caption text-muted-foreground">
      A new branch starts from {primary?.baseBranch ?? "the base branch"}.
    </p>
    {#if checkedOutIn}
      <p class="text-caption text-destructive">{problem}</p>
    {/if}
  </div>
  <div class="grid gap-1.5">
    <Label for={`${fieldId}-id`}>Worktree ID</Label>
    <Input
      id={`${fieldId}-id`}
      bind:value={id}
      placeholder={defaultId || "From the branch name"}
      autocomplete="off"
    />
    {#if problem && !checkedOutIn}
      <p class="text-caption text-destructive">{problem}</p>
    {/if}
    <p
      class="truncate font-mono text-caption text-muted-foreground"
      title={preview}
    >
      {preview}
    </p>
  </div>
</FormDialog>
