<script lang="ts">
import { WorkbenchShell } from "$lib/presentation/shell";
import DesktopShutdownOverlay from "$lib/app/shell/DesktopShutdownOverlay.svelte";
import WorkbenchEditorHost from "$lib/app/shell/WorkbenchEditorHost.svelte";
import PanelViewHost from "$lib/app/composition/WorkbenchPanelHost.svelte";
import ProjectDialogHost from "$lib/app/shell/ProjectDialogHost.svelte";
import WorkbenchStatusBarHost from "$lib/app/shell/WorkbenchStatusBarHost.svelte";
import WorkbenchTitlebarHost from "$lib/app/shell/WorkbenchTitlebarHost.svelte";
import { panelViewDescriptors } from "$lib/app/composition/panel-views";
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
import BrowserNotificationPrompt from "$lib/application/notifications/BrowserNotificationPrompt.svelte";
import CriticalErrorDialog from "$lib/application/notifications/CriticalErrorDialog.svelte";
import { OnboardingHost } from "$lib/app/onboarding";
import { workspaceSelectors } from "$lib/application/workspace";

const isCompact = $derived(responsive.isCompact);
const activeEditorTab = $derived(workspaceSelectors.activeCenterTab);
function panelViewEnabled(viewIds: readonly string[]): boolean {
  return Object.entries(shellLayout.current.docks).some(([dockId, dock]) => {
    if (!dock.activeViewId || !viewIds.includes(dock.activeViewId))
      return false;
    if (!isCompact) return !dock.collapsed;
    return dockId === "left" ? shellSheets.primary : shellSheets.secondary;
  });
}

const gitPanelEnabled = $derived(panelViewEnabled(["git", "pull-requests"]));
const pullRequestsPanelEnabled = $derived(panelViewEnabled(["pull-requests"]));
const gitPanel = createWorkbenchGitPanelAdapter(
  () => workspaceSelectors.activeProject,
  () => gitPanelEnabled,
  () => pullRequestsPanelEnabled,
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
  {#snippet titlebar()}<WorkbenchTitlebarHost />{/snippet}
  {#snippet editor()}<WorkbenchEditorHost />{/snippet}
  {#snippet panelView(viewId)}
    <PanelViewHost
      {viewId}
      gitModel={gitPanel.model}
      gitActions={gitPanel.actions}
    />
  {/snippet}
  {#snippet statusBar()}<WorkbenchStatusBarHost />{/snippet}
  {#snippet overlays()}
    <BrowserNotificationPrompt />
    <CriticalErrorDialog />
    <OnboardingHost />
    <DesktopShutdownOverlay />
  {/snippet}
</WorkbenchShell>

<ProjectDialogHost />
