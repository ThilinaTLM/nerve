<script lang="ts">
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import SettingsCenter from "./SettingsCenter.svelte";
</script>

<SettingsCenter
  bind:pageId={settingsState.activePageId}
  bind:sectionId={settingsState.activeSectionId}
  bind:itemId={settingsState.activeItemId}
/>
