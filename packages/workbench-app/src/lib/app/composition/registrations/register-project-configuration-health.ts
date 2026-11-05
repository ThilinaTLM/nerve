import { projectConfigurationHealth } from "$lib/application/project-configuration/project-configuration-health-state.svelte";
import { invalidateLaunchCatalog } from "$lib/features/launches/state/launch-definitions.svelte";

import { getProject } from "$lib/features/projects/api/projects.api";
import { getDesktopBridge } from "$lib/platform/desktop/desktop-bridge.svelte";
import { selectProject } from "$lib/application/workspace/workspace-actions.svelte";
import { activatePanelView } from "$lib/app/shell/shell-layout.svelte";
import { loadFileExplorerDirectory } from "$lib/features/filesystem/state/file-explorer-actions.svelte";
import { ensureFileExplorerProject } from "$lib/features/filesystem/state/file-explorer-state.svelte";
import { fileExplorerEntryNodeId } from "$lib/features/filesystem/state/file-explorer-tree";

/** `path` relative to `root` when it is the root or inside it, else undefined. */
function projectRelativeFolder(root: string, path: string): string | undefined {
  const normalize = (value: string) =>
    value.replaceAll("\\", "/").replace(/\/+$/, "");
  const base = normalize(root);
  const target = normalize(path);
  if (target === base) return "";
  return target.startsWith(`${base}/`)
    ? target.slice(base.length + 1)
    : undefined;
}

/** A reloaded or reset file changes what the launch catalog should show. */
export function registerProjectConfigurationHealthEffects(): () => void {
  const stopHealth = projectConfigurationHealth.onApplied(
    (health) => void invalidateLaunchCatalog(health.projectId).catch(() => {}),
  );
  const stopFolder = projectConfigurationHealth.registerFolderOpener(
    async (issue) => {
      const desktop = getDesktopBridge();
      if (desktop) {
        const project = await getProject(issue.projectId);
        const relativePath = project
          ? projectRelativeFolder(project.directory, issue.path)
          : undefined;
        if (relativePath !== undefined) {
          await desktop.files.openProjectEntry({
            projectId: issue.projectId,
            relativePath,
          });
          return;
        }
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
