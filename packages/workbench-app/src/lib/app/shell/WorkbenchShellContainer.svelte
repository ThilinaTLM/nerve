<script lang="ts">
import { WorkbenchShell } from "@nervekit/workbench-ui/shell";
import DesktopShutdownOverlay from "$lib/app/shell/DesktopShutdownOverlay.svelte";
import EditorSurface from "$lib/app/shell/EditorSurface.svelte";
import PanelViewHost from "$lib/app/shell/PanelViewHost.svelte";
import ProjectDialogs from "$lib/app/shell/ProjectDialogs.svelte";
import StatusBarContainer from "$lib/app/shell/StatusBarContainer.svelte";
import TitlebarContainer from "$lib/app/shell/TitlebarContainer.svelte";
import { panelViewDescriptors } from "$lib/app/shell/panel-views";
import { responsive } from "$lib/app/shell/responsive.svelte";
import {
  activatePanelView,
  closeSheets,
  hidePanelView,
  movePanelView,
  resizeDock,
  setSheetOpen,
  shellLayout,
  shellSheets,
  toggleDock,
} from "$lib/app/shell/shell-layout.svelte";
import { createWorkbenchGitPanelAdapter } from "$lib/features/git";
import BrowserNotificationPrompt from "$lib/features/notifications/BrowserNotificationPrompt.svelte";
import { workspaceSelectors } from "$lib/features/workspace";

const isCompact = $derived(responsive.isCompact);
const activeEditorTab = $derived(workspaceSelectors.activeCenterTab);
const gitPanelEnabled = $derived(
  Object.entries(shellLayout.current.docks).some(([dockId, dock]) => {
    const gitViewActive =
      dock.activeViewId === "git" || dock.activeViewId === "pull-requests";
    if (!gitViewActive) return false;
    if (!isCompact) return !dock.collapsed;
    return dockId === "left" ? shellSheets.primary : shellSheets.secondary;
  }),
);
const gitPanel = createWorkbenchGitPanelAdapter(
  () => workspaceSelectors.activeProject,
  () => gitPanelEnabled,
);

let lastTabKey: string | undefined;
$effect(() => {
  const key = activeEditorTab
    ? `${activeEditorTab.kind}:${activeEditorTab.id}`
    : undefined;
  if (key === lastTabKey) return;
  lastTabKey = key;
  if (shellSheets.primary) closeSheets();
});

$effect(() => {
  if (!isCompact && (shellSheets.primary || shellSheets.secondary)) {
    closeSheets();
  }
});
</script>

<WorkbenchShell
  layout={shellLayout.current}
  descriptors={panelViewDescriptors}
  compact={isCompact}
  primarySheetOpen={shellSheets.primary}
  secondarySheetOpen={shellSheets.secondary}
  actions={{
    onActivateView: activatePanelView,
    onMoveView: movePanelView,
    onHideView: hidePanelView,
    onToggleDock: toggleDock,
    onDockResize: resizeDock,
    onSheetOpenChange: setSheetOpen,
  }}
>
  {#snippet titlebar()}<TitlebarContainer />{/snippet}
  {#snippet editor()}<EditorSurface />{/snippet}
  {#snippet panelView(viewId)}
    <PanelViewHost
      {viewId}
      gitModel={gitPanel.model}
      gitActions={gitPanel.actions}
    />
  {/snippet}
  {#snippet statusBar()}<StatusBarContainer />{/snippet}
  {#snippet overlays()}
    <BrowserNotificationPrompt />
    <DesktopShutdownOverlay />
  {/snippet}
</WorkbenchShell>

<ProjectDialogs />
