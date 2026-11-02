<script lang="ts">
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import GitBranch from "@lucide/svelte/icons/git-branch";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { MobileScreen } from "$lib/presentation/shell";
import type { GitPanelActions, GitPanelModel } from "$lib/features/git";
import MobileGitChangesBody from "./MobileGitChangesBody.svelte";
import { branchSubtitle } from "./mobile-git-summary";
import { backFromMobileScreen, pushMobileScreen } from "./mobile-shell.svelte";

/** Standalone Git changes screen (from project home) around the shared body. */
let {
  projectId,
  model,
  actions: gitActions,
}: {
  projectId: string;
  model: GitPanelModel;
  actions: GitPanelActions;
} = $props();

const summary = $derived(model.repositorySummary);
let repositoryPickerOpen = $state(false);
let remoteSheetOpen = $state(false);
</script>

<MobileScreen
  title={summary?.name ?? "Git changes"}
  subtitle={branchSubtitle(summary)}
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
      size="icon"
      ariaLabel="Branches"
      disabled={!model.availability.available}
      onclick={() => pushMobileScreen({ kind: "branches", projectId })}
    >
      <GitBranch size={17} strokeWidth={1.9} />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      ariaLabel="Refresh"
      disabled={model.refreshing}
      onclick={() => void gitActions.refreshAll()}
    >
      <RefreshCw size={17} strokeWidth={1.9} />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      ariaLabel="Sync actions"
      disabled={!summary?.hasRemote}
      onclick={() => (remoteSheetOpen = true)}
    >
      <EllipsisVertical size={18} strokeWidth={1.9} />
    </Button>
  {/snippet}

  <MobileGitChangesBody
    {projectId}
    {model}
    actions={gitActions}
    bind:repositoryPickerOpen
    bind:remoteSheetOpen
  />
</MobileScreen>
