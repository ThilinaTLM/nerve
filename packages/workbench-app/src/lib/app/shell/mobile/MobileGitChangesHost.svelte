<script lang="ts">
import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
import ArrowUpFromLine from "@lucide/svelte/icons/arrow-up-from-line";
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import Archive from "@lucide/svelte/icons/archive";
import ArchiveRestore from "@lucide/svelte/icons/archive-restore";
import GitBranch from "@lucide/svelte/icons/git-branch";
import Minus from "@lucide/svelte/icons/minus";
import Plus from "@lucide/svelte/icons/plus";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Trash2 from "@lucide/svelte/icons/trash-2";
import Undo2 from "@lucide/svelte/icons/undo-2";
import type {
  GitDiffArea,
  GitFileChange,
  GitStashArea,
  GitStashEntry,
} from "@nervekit/contracts/git";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import {
  MobileActionSheet,
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import {
  gitFileGroups,
  gitFilesInScope,
  type GitPanelActions,
  type GitPanelModel,
} from "$lib/features/git";
import { openMobileCenter } from "./mobile-route-activation.svelte";
import { backFromMobileScreen, pushMobileScreen } from "./mobile-shell.svelte";

/**
 * Working-tree changes for the selected repository: staged, changed and
 * untracked files, each opening its diff, with staging, discarding, stashes,
 * sync, and a way into branch management.
 */
let {
  projectId,
  model,
  actions: gitActions,
}: {
  projectId: string;
  model: GitPanelModel;
  actions: GitPanelActions;
} = $props();

const repository = $derived(model.selectedRepository);
const summary = $derived(model.repositorySummary);
const groups = $derived(gitFileGroups(model.changes?.files ?? []));
const changed = $derived(groups.unstaged.filter((file) => !file.untracked));
const untracked = $derived(groups.unstaged.filter((file) => file.untracked));
const total = $derived(
  groups.staged.length + changed.length + untracked.length,
);
const subtitle = $derived.by(() => {
  if (!summary) return undefined;
  const branch = summary.currentBranch ?? "detached";
  const sync: string[] = [];
  if (summary.ahead) sync.push(`↑${summary.ahead}`);
  if (summary.behind) sync.push(`↓${summary.behind}`);
  return [branch, sync.join(" ")].filter(Boolean).join(" · ");
});

let repositoryPickerOpen = $state(false);
let remoteSheetOpen = $state(false);
let discardTarget = $state<GitFileChange>();
let discardAllOpen = $state(false);
let dropTarget = $state<GitStashEntry>();

const unstagedCount = $derived(
  gitFilesInScope(model.changes?.files ?? [], "unstaged").length,
);
const bulkBusy = $derived(Boolean(model.operations.bulkMutation));
const stashBusy = $derived(Boolean(model.operations.stashMutation));
const canBulk = $derived(model.capabilities.bulkMutateFiles.enabled);
const canStash = $derived(model.capabilities.stashes.enabled);

const stagedMenu = $derived<ContextMenuItem[]>([
  {
    label: "Unstage all",
    icon: Minus,
    disabled: !canBulk || bulkBusy,
    onSelect: () =>
      void gitActions.mutateFileScope(repository, "staged", "unstage"),
  },
  {
    label: "Stash staged",
    icon: Archive,
    disabled: !canStash || stashBusy,
    onSelect: () => void gitActions.createStash(repository, "staged"),
  },
]);

const unstagedMenu = $derived<ContextMenuItem[]>([
  {
    label: "Stage all",
    icon: Plus,
    disabled: !canBulk || bulkBusy,
    onSelect: () =>
      void gitActions.mutateFileScope(repository, "unstaged", "stage"),
  },
  {
    label: "Stash changes",
    icon: Archive,
    disabled: !canStash || stashBusy,
    onSelect: () => void gitActions.createStash(repository, "unstaged"),
  },
  { type: "separator" },
  {
    label: "Discard all",
    icon: Undo2,
    destructive: true,
    disabled: !canBulk || bulkBusy,
    onSelect: () => (discardAllOpen = true),
  },
]);

function stashMenu(stash: GitStashEntry): ContextMenuItem[] {
  return [
    {
      label: "Apply",
      icon: ArchiveRestore,
      disabled: !canStash || stashBusy,
      onSelect: () => void gitActions.applyStash(repository, stash),
    },
    {
      label: "Drop",
      icon: Trash2,
      destructive: true,
      disabled: !canStash || stashBusy,
      onSelect: () => (dropTarget = stash),
    },
  ];
}

const repositoryItems = $derived<ContextMenuItem[]>(
  model.repositories.map((repo) => ({
    label: repo.relativePath === "." ? repo.name : repo.relativePath,
    icon: GitBranch,
    disabled: repo.relativePath === repository,
    onSelect: () => void gitActions.selectRepository(repo.relativePath),
  })),
);

const remoteItems = $derived<ContextMenuItem[]>([
  {
    label: "Pull",
    icon: ArrowDownToLine,
    disabled: !model.capabilities.remote.pull.enabled,
    onSelect: () => void gitActions.runRemoteOperation(repository, "pull"),
  },
  {
    label: "Push",
    icon: ArrowUpFromLine,
    disabled: !model.capabilities.remote.push.enabled,
    onSelect: () => void gitActions.runRemoteOperation(repository, "push"),
  },
  {
    label: "Fetch",
    icon: RefreshCw,
    disabled: !model.capabilities.remote.fetch.enabled,
    onSelect: () => void gitActions.runRemoteOperation(repository, "fetch"),
  },
]);

function statusLetter(file: GitFileChange, area: GitDiffArea): string {
  if (file.untracked) return "U";
  const code = area === "staged" ? file.index : file.worktree;
  return code.trim() || "M";
}

function tone(file: GitFileChange, area: GitDiffArea): StatusTone {
  const letter = statusLetter(file, area);
  if (letter === "D") return "destructive";
  if (letter === "A" || letter === "U") return "success";
  return "warning";
}

function splitPath(path: string): { name: string; dir: string } {
  const index = path.lastIndexOf("/");
  return index < 0
    ? { name: path, dir: "" }
    : { name: path.slice(index + 1), dir: path.slice(0, index) };
}

function openDiff(file: GitFileChange, area: GitDiffArea) {
  void openMobileCenter("diff", () =>
    gitActions.openDiff(repository, file, area),
  );
}

function stashArea(area: GitDiffArea): GitStashArea {
  return area === "staged" ? "staged" : "unstaged";
}

function menu(file: GitFileChange, area: GitDiffArea): ContextMenuItem[] {
  const canMutate = model.capabilities.mutateFiles.enabled;
  const items: ContextMenuItem[] = [
    area === "staged"
      ? {
          label: "Unstage",
          icon: Minus,
          disabled: !canMutate,
          onSelect: () =>
            void gitActions.mutateFile(repository, file, "unstage"),
        }
      : {
          label: "Stage",
          icon: Plus,
          disabled: !canMutate,
          onSelect: () => void gitActions.mutateFile(repository, file, "stage"),
        },
  ];
  items.push({
    label: "Stash this file",
    icon: Archive,
    disabled: !canStash || stashBusy,
    onSelect: () =>
      void gitActions.createStash(repository, stashArea(area), file.path),
  });
  if (area === "unstaged") {
    items.push({
      label: file.untracked ? "Delete file" : "Discard changes",
      icon: Undo2,
      destructive: true,
      disabled: !canMutate,
      onSelect: () => (discardTarget = file),
    });
  }
  return items;
}
</script>

{#snippet fileRows(files: GitFileChange[], area: GitDiffArea)}
  {#each files as file (`${area}:${file.path}`)}
    {@const parts = splitPath(file.path)}
    <MobileListRow
      title={parts.name}
      detail={parts.dir || undefined}
      meta={statusLetter(file, area)}
      tone={tone(file, area)}
      menuItems={menu(file, area)}
      menuTitle={file.path}
      onclick={() => openDiff(file, area)}
    />
  {/each}
{/snippet}

<MobileScreen
  title={summary?.name ?? "Git changes"}
  {subtitle}
  onBack={backFromMobileScreen}
  backLabel="Back"
  onTitleSelect={model.repositories.length > 1
    ? () => (repositoryPickerOpen = true)
    : undefined}
  titleLabel="Switch repository"
>
  {#snippet actions()}
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Branches"
      disabled={!model.availability.available}
      onclick={() => pushMobileScreen({ kind: "branches", projectId })}
    >
      <GitBranch size={17} strokeWidth={1.9} />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Refresh"
      disabled={model.refreshing}
      onclick={() => void gitActions.refreshAll()}
    >
      <RefreshCw size={17} strokeWidth={1.9} />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Sync actions"
      disabled={!summary?.hasRemote}
      onclick={() => (remoteSheetOpen = true)}
    >
      <EllipsisVertical size={18} strokeWidth={1.9} />
    </Button>
  {/snippet}

  {#if !model.availability.available}
    <p class="px-6 py-10 text-center text-sm text-muted-foreground">
      {model.availability.message}
    </p>
  {:else if model.initialLoading}
    <p class="px-6 py-10 text-center text-sm text-muted-foreground">
      Loading changes…
    </p>
  {:else if total === 0}
    <Empty.Root class="px-6 py-10">
      <Empty.Header>
        <Empty.Media class="text-success">
          <GitBranch size={28} strokeWidth={1.6} />
        </Empty.Media>
        <Empty.Title class="text-sm">Working tree clean</Empty.Title>
        <Empty.Description class="text-xs">
          {model.repositories.length
            ? "No uncommitted changes in this repository."
            : (model.emptyMessage ?? "No Git repository in this project.")}
        </Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {:else}
    {#if groups.staged.length}
      <MobileSection
        title="Staged"
        meta={`${groups.staged.length}`}
        menuItems={stagedMenu}
        menuTitle="Staged changes"
      >
        {@render fileRows(groups.staged, "staged")}
      </MobileSection>
    {/if}
    {#if changed.length}
      <MobileSection
        title="Changes"
        meta={`${changed.length}`}
        menuItems={unstagedMenu}
        menuTitle="Unstaged changes"
      >
        {@render fileRows(changed, "unstaged")}
      </MobileSection>
    {/if}
    {#if untracked.length}
      <MobileSection
        title="Untracked"
        meta={`${untracked.length}`}
        menuItems={changed.length ? undefined : unstagedMenu}
        menuTitle="Unstaged changes"
      >
        {@render fileRows(untracked, "unstaged")}
      </MobileSection>
    {/if}
  {/if}
  {#if model.availability.available && model.stashes.length}
    <MobileSection title="Stashes" meta={`${model.stashes.length}`}>
      {#each model.stashes as stash (stash.hash)}
        <MobileListRow
          title={stash.message || stash.ref}
          detail={stash.ref}
          meta={stash.relativeDate}
          icon={Archive}
          menuItems={stashMenu(stash)}
        />
      {/each}
    </MobileSection>
  {/if}
</MobileScreen>

<MobileActionSheet
  open={repositoryPickerOpen}
  title="Repository"
  items={repositoryItems}
  onOpenChange={(open) => (repositoryPickerOpen = open)}
/>
<MobileActionSheet
  open={remoteSheetOpen}
  title="Sync"
  items={remoteItems}
  onOpenChange={(open) => (remoteSheetOpen = open)}
/>
<ConfirmDialog
  bind:open={discardAllOpen}
  title="Discard all changes?"
  description={`This will permanently discard all ${unstagedCount} unstaged ${unstagedCount === 1 ? "change" : "changes"}.`}
  confirmLabel="Discard all"
  destructive
  onConfirm={() =>
    void gitActions.mutateFileScope(repository, "unstaged", "discard")}
/>
<ConfirmDialog
  open={Boolean(dropTarget)}
  title="Drop stash?"
  description={`${dropTarget?.ref ?? ""} (${dropTarget?.message ?? ""}) will be deleted. This cannot be undone.`}
  confirmLabel="Drop"
  destructive
  onConfirm={() => {
    if (dropTarget) void gitActions.dropStash(repository, dropTarget);
    dropTarget = undefined;
  }}
  onOpenChange={(open) => {
    if (!open) dropTarget = undefined;
  }}
/>
<ConfirmDialog
  open={Boolean(discardTarget)}
  title={discardTarget?.untracked ? "Delete file?" : "Discard changes?"}
  description={discardTarget
    ? discardTarget.untracked
      ? `${discardTarget.path} is not tracked by git and will be deleted. This cannot be undone.`
      : `${discardTarget.path} will be restored to its last committed state. This cannot be undone.`
    : ""}
  confirmLabel={discardTarget?.untracked ? "Delete" : "Discard"}
  destructive
  onConfirm={() => {
    if (discardTarget)
      void gitActions.mutateFile(repository, discardTarget, "discard");
    discardTarget = undefined;
  }}
  onOpenChange={(open) => {
    if (!open) discardTarget = undefined;
  }}
/>
