<script lang="ts">
  import SettingsPage from "$lib/features/settings/components/SettingsPage.svelte";
  import { settingsSelectors } from "$lib/features/settings/state/settings-selectors.svelte";
  import { workspaceSelectors } from "$lib/features/workspace/state/workspace-selectors.svelte";
  import {
    queueSettingsSave,
    setTheme,
    workbenchState,
  } from "$lib/stores/workbench.svelte";

  const status = $derived(workspaceSelectors.status);
  const settingsSaveStatus = $derived(settingsSelectors.settingsSaveStatus);
  const settingsMessage = $derived(settingsSelectors.settingsMessage);
</script>

<SettingsPage
  {status}
  bind:settingsDraft={workbenchState.settingsDraft}
  models={workbenchState.models}
  authProviders={workbenchState.authProviders}
  {settingsSaveStatus}
  {settingsMessage}
  onSettingsChange={queueSettingsSave}
  onThemeChange={setTheme}
/>
