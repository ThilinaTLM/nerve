<script lang="ts">
import type { Settings, UpdateSettingsRequest } from "$lib/api";
import type { SettingsPageDef } from "$lib/presentation/settings";
import type { SettingsScopeTarget } from "$lib/features/settings/registry/settings-scope";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import type { Project } from "@nervekit/contracts/core";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import { layeredPageIds } from "$lib/features/settings/registry/settings-pages";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import StoragePageActions from "$lib/features/settings/views/pages/storage/StoragePageActions.svelte";
import ProfilesPageActions from "$lib/features/settings/views/pages/agent-profiles/ProfilesPageActions.svelte";
import SuggestionsPageActions from "./suggestions/SuggestionsPageActions.svelte";
import type { SettingsPageControllers } from "./settings-page-controllers.svelte";

/** Header actions owned by a settings page (import, refresh, cleanup, reset). */
let {
  page,
  target,
  controllers,
  settingsDraft,
  project,
}: {
  page: SettingsPageDef;
  target: SettingsScopeTarget;
  controllers: SettingsPageControllers;
  settingsDraft?: Settings;
  /** The open project, when the surface shows one. */
  project?: Project;
  onSettingsChange?: (
    patch: UpdateSettingsRequest,
    options?: { immediate?: boolean; debounceMs?: number },
  ) => void;
} = $props();

// Project differences are summarised where the project's values are shown:
// every page of a project tab, and the layered pages of a user tab with a project open.
const differing = $derived(
  project && (target.kind === "project" || layeredPageIds.includes(page.id))
    ? (controllers.pageDiffs()[page.id] ?? 0)
    : 0,
);
let confirmOpen = $state(false);
let resetting = $state(false);

async function resetAll(): Promise<void> {
  resetting = true;
  try {
    await controllers.resetProjectPage(page.id);
  } finally {
    resetting = false;
  }
}
</script>

{#if settingsDraft}
  {#if page.id === "suggestions"}
    <SuggestionsPageActions pageState={controllers.suggestionsPageState} />
  {:else if page.id === "extensions"}
    {@const extensionsPage = controllers.extensionsPageController}
    <Button
      size="sm"
      variant="outline"
      disabled={extensionsPage.busy || !extensionsPage.reload}
      onclick={() => void extensionsPage.run()}
      ><RefreshCw class="size-3.5" />Reload</Button
    >
  {:else if page.id === "agents" || page.id === "sub-agents"}
    <ProfilesPageActions pageId={page.id} />
  {:else if page.id === "storage"}
    <StoragePageActions controller={controllers.storageController} />
  {/if}
  {#if differing > 0}
    <span class="text-ui text-muted-foreground"
      >{differing} differ from your settings</span
    >
    <Button
      size="sm"
      variant="outline"
      disabled={resetting}
      onclick={() => (confirmOpen = true)}>Reset all</Button
    >
    <ConfirmDialog
      bind:open={confirmOpen}
      title={`Reset ${page.label} for this project?`}
      description={`Removes ${differing} project ${differing === 1 ? "override" : "overrides"}. ${page.label} will follow your user settings again.`}
      confirmLabel="Reset all"
      destructive
      onConfirm={() => void resetAll()}
    />
  {/if}
{/if}
