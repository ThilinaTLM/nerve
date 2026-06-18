<script lang="ts">
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";

  import Titlebar from "$lib/app/layout/Titlebar.svelte";
  import {
    closeDesktopWindow,
    desktopRuntime,
    minimizeDesktopWindow,
    toggleMaximizeDesktopWindow,
  } from "$lib/features/desktop/state/desktop-bridge.svelte";
  import { settingsSelectors } from "$lib/features/settings/state/settings-selectors.svelte";
  import { workspaceSelectors } from "$lib/features/workspace/state/workspace-selectors.svelte";
  import { openLogsPane } from "$lib/features/logs/state/logs.svelte";
  import { openSettingsPane } from "$lib/features/settings/state/settings-actions.svelte";
  import { workbenchUiState } from "$lib/app/state/workbench-ui-state.svelte";

  const activeProject = $derived(workspaceSelectors.activeProject);
  const activeCenterTab = $derived(workspaceSelectors.activeCenterTab);
  const settingsDraft = $derived(settingsSelectors.settingsDraft);
  const desktopQuitting = $derived(
    desktopRuntime.quitting || workbenchUiState.desktopQuitRequested,
  );

  function openProjectPicker() {
    workspaceState.projectPickerOpen = true;
  }

  async function handleDesktopClose() {
    const closeToTray = settingsDraft?.desktop.closeToTray ?? true;
    if (!closeToTray) {
      workbenchUiState.desktopQuitRequested = true;
      desktopRuntime.quitting = true;
    }
    try {
      await closeDesktopWindow({ closeToTray });
    } catch (caught) {
      if (!closeToTray) {
        workbenchUiState.desktopQuitRequested = false;
        desktopRuntime.quitting = false;
      }
      workspaceState.error =
        caught instanceof Error ? caught.message : String(caught);
    }
  }
</script>

<Titlebar
  {activeProject}
  desktop={desktopRuntime.isDesktop}
  maximized={desktopRuntime.windowState.maximized}
  closeToTray={settingsDraft?.desktop.closeToTray ?? true}
  quitting={desktopQuitting}
  settingsActive={activeCenterTab?.kind === "settings"}
  logsActive={activeCenterTab?.kind === "logs"}
  onOpenProject={openProjectPicker}
  onOpenLogs={() => openLogsPane()}
  onOpenSettings={() => void openSettingsPane()}
  onMinimize={() => void minimizeDesktopWindow()}
  onToggleMaximize={() => void toggleMaximizeDesktopWindow()}
  onClose={() => void handleDesktopClose()}
/>
