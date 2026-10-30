import { projectConfigurationHealth } from "$lib/application/project-configuration/project-configuration-health-state.svelte";
import { invalidateLaunchCatalog } from "$lib/features/launches/state/launch-definitions.svelte";

import { getDesktopBridge } from "$lib/platform/desktop/desktop-bridge.svelte";
import { selectProject } from "$lib/application/workspace/workspace-actions.svelte";
import { activatePanelView } from "$lib/app/shell/shell-layout.svelte";
import { loadFileExplorerDirectory } from "$lib/features/filesystem/state/file-explorer-actions.svelte";
import { ensureFileExplorerProject } from "$lib/features/filesystem/state/file-explorer-state.svelte";
import { fileExplorerEntryNodeId } from "$lib/features/filesystem/state/file-explorer-tree";

/** A reloaded or reset file changes what the launch catalog should show. */
export function registerProjectConfigurationHealthEffects(): () => void {
  const stopHealth = projectConfigurationHealth.onApplied(
    (health) => void invalidateLaunchCatalog(health.projectId).catch(() => {}),
  );
  const stopFolder = projectConfigurationHealth.registerFolderOpener(
    async (issue) => {
      const desktop = getDesktopBridge();
      if (desktop) {
        await desktop.files.openProjectEntry({
          root: issue.path,
          relativePath: "",
        });
        return;
      }
      await selectProject(issue.projectId);
      await loadFileExplorerDirectory(issue.projectId, "", { refresh: true });
      await loadFileExplorerDirectory(issue.projectId, ".nerve", {
        refresh: true,
      });
      ensureFileExplorerProject(issue.projectId).expandedIds.add(
        fileExplorerEntryNodeId(issue.projectId, ".nerve"),
      );
      activatePanelView("files");
    },
  );
  return () => {
    stopHealth();
    stopFolder();
  };
}
