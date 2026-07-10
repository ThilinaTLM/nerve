<script lang="ts">
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";

import SettingsPage from "$lib/features/settings/components/SettingsPage.svelte";
import { settingsSelectors } from "$lib/features/settings/state/settings-selectors.svelte";
import { workspaceSelectors } from "$lib/features/workspace/state/workspace-selectors.svelte";
import {
  queueSettingsSave,
  setTheme,
} from "$lib/features/settings/state/settings-actions.svelte";

const status = $derived(workspaceSelectors.status);
const settingsSaveStatus = $derived(settingsSelectors.settingsSaveStatus);
const settingsMessage = $derived(settingsSelectors.settingsMessage);
</script>

<SettingsPage
  {status}
  bind:settingsDraft={settingsState.settingsDraft}
  models={settingsState.models}
  authProviders={settingsState.authProviders}
  {settingsSaveStatus}
  {settingsMessage}
  onSettingsChange={queueSettingsSave}
  onThemeChange={setTheme}
/>
