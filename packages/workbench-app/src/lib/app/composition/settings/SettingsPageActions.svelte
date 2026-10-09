<script lang="ts">
import type { Settings, UpdateSettingsRequest } from "$lib/api";
import type { SettingsPageDef } from "$lib/presentation/settings";
import ModelsPageActions from "$lib/features/settings/views/pages/models/ModelsPageActions.svelte";
import StoragePageActions from "$lib/features/settings/views/pages/storage/StoragePageActions.svelte";
import type { SettingsPageControllers } from "./settings-page-controllers.svelte";

/** Header actions owned by a settings page (import, refresh, cleanup). */
let {
  page,
  controllers,
  settingsDraft,
  onSettingsChange,
}: {
  page: SettingsPageDef;
  controllers: SettingsPageControllers;
  settingsDraft?: Settings;
  onSettingsChange?: (
    patch: UpdateSettingsRequest,
    options?: { immediate?: boolean; debounceMs?: number },
  ) => void;
} = $props();
</script>

{#if settingsDraft}
  {#if page.id === "models"}
    <ModelsPageActions {settingsDraft} {onSettingsChange} />
  {:else if page.id === "storage"}
    <StoragePageActions controller={controllers.storageController} />
  {/if}
{/if}
