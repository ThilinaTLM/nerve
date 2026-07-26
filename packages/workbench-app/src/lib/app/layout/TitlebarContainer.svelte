<script lang="ts">
import Titlebar from "$lib/app/layout/Titlebar.svelte";
import {
  closeDesktopWindow,
  desktopRuntime,
  desktopShutdownState,
  minimizeDesktopWindow,
  toggleMaximizeDesktopWindow,
} from "$lib/features/desktop";
import { openAuthPane } from "$lib/features/auth";
import { openLogsPane } from "$lib/features/logs";
import { openSettingsPane, settingsSelectors } from "$lib/features/settings";
import {
  selectProject,
  workspaceSelectors,
  workspaceState,
} from "$lib/features/workspace";
import { quickProjectItems } from "$lib/features/projects";
import { responsive } from "$lib/app/layout/responsive.svelte";

const projectItems = $derived(workspaceSelectors.projectSwitcherItems);
const quickLimit = $derived(
  responsive.isPhone ? 1 : responsive.isCompact ? 2 : 5,
);
const quickProjects = $derived(
  quickProjectItems(
    projectItems,
    workspaceState.selectedProjectKey,
    quickLimit,
  ),
);
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
  projects={quickProjects}
  activeProjectKey={workspaceState.selectedProjectKey}
  desktop={desktopRuntime.isDesktop}
  maximized={desktopRuntime.windowState.maximized}
  closeToTray={settingsDraft?.desktop.closeToTray ?? true}
  quitting={desktopQuitting}
  settingsActive={activeCenterTab?.kind === "settings"}
  authActive={activeCenterTab?.kind === "auth"}
  logsActive={activeCenterTab?.kind === "logs"}
  onOpenProject={openProjectPicker}
  onSelectProject={(projectId) => void selectProject(projectId)}
  onOpenLogs={() => openLogsPane()}
  onOpenAuth={() => openAuthPane()}
  onOpenSettings={() => void openSettingsPane()}
  onMinimize={() => void minimizeDesktopWindow()}
  onToggleMaximize={() => void toggleMaximizeDesktopWindow()}
  onClose={() => void handleDesktopClose()}
/>
