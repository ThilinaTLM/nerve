<script lang="ts">
import type { Settings, UpdateSettingsRequest } from "$lib/api";
import type { SettingsPageDef } from "$lib/presentation/settings";
import type { SettingsScopeTarget } from "$lib/features/settings/registry/settings-scope";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ModelsPageActions from "$lib/features/settings/views/pages/models/ModelsPageActions.svelte";
import StoragePageActions from "$lib/features/settings/views/pages/storage/StoragePageActions.svelte";
import SuggestionsPageActions from "./suggestions/SuggestionsPageActions.svelte";
import type { SettingsPageControllers } from "./settings-page-controllers.svelte";

/** Header actions owned by a settings page (import, refresh, cleanup, reset). */
let {
  page,
  target,
  controllers,
  settingsDraft,
  onSettingsChange,
}: {
  page: SettingsPageDef;
  target: SettingsScopeTarget;
  controllers: SettingsPageControllers;
  settingsDraft?: Settings;
  onSettingsChange?: (
    patch: UpdateSettingsRequest,
    options?: { immediate?: boolean; debounceMs?: number },
  ) => void;
} = $props();

const differing = $derived(
  target.kind === "project" ? (controllers.pageDiffs()[page.id] ?? 0) : 0,
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
  {#if page.id === "models"}
    <ModelsPageActions {settingsDraft} {onSettingsChange} />
  {:else if page.id === "suggestions"}
    <SuggestionsPageActions pageState={controllers.suggestionsPageState} />
  {:else if page.id === "storage"}
    <StoragePageActions controller={controllers.storageController} />
  {/if}
  {#if differing > 0}
    <span class="text-xs text-muted-foreground"
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
