<script lang="ts">
import { userSettingsScope } from "$lib/features/settings/registry/settings-scope";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import SettingsCenter from "./SettingsCenter.svelte";
</script>

<SettingsCenter
  target={userSettingsScope}
  bind:pageId={settingsState.activePageId}
  bind:sectionId={settingsState.activeSectionId}
/>
