<script lang="ts">
  import Titlebar from "$lib/app/layout/Titlebar.svelte";
  import {
    closeDesktopWindow,
    desktopRuntime,
    desktopShutdownState,
    minimizeDesktopWindow,
    toggleMaximizeDesktopWindow,
  } from "$lib/features/desktop";
  import { openLogsPane } from "$lib/features/logs";
  import { openSettingsPane, settingsSelectors } from "$lib/features/settings";
  import { workspaceSelectors, workspaceState } from "$lib/features/workspace";

  const activeProject = $derived(workspaceSelectors.activeProject);
  const activeCenterTab = $derived(workspaceSelectors.activeCenterTab);
  const settingsDraft = $derived(settingsSelectors.settingsDraft);
  const desktopQuitting = $derived(
    desktopRuntime.quitting || desktopShutdownState.quitRequested,
  );

  function openProjectPicker() {
    workspaceState.projectPickerOpen = true;
  }

  async function handleDesktopClose() {
    const closeToTray = settingsDraft?.desktop.closeToTray ?? true;
    if (!closeToTray) {
      desktopShutdownState.quitRequested = true;
      desktopRuntime.quitting = true;
    }
    try {
      await closeDesktopWindow({ closeToTray });
    } catch (caught) {
      if (!closeToTray) {
        desktopShutdownState.quitRequested = false;
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
