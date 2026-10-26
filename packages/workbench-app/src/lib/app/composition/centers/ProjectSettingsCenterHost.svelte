<script lang="ts">
import { projectSettingsScope } from "$lib/features/settings/registry/settings-scope";
import { resolveSettingsPageId } from "$lib/features/settings/registry/settings-pages";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import SettingsCenter from "./SettingsCenter.svelte";

/**
 * The active tab is this project's settings; its id is the project id. Read
 * once: the shell remounts this host per tab, so the target never changes.
 */
const active = workspaceState.activeCenterTab;
const projectId = active?.kind === "project-settings" ? active.id : undefined;
const project = $derived(
  workspaceState.projects.find((candidate) => candidate.id === projectId),
);
const target = projectId ? projectSettingsScope(projectId) : undefined;
// Restored tabs can mount without going through openProjectSettingsPane.
if (projectId && !settingsState.projectViews[projectId]) {
  settingsState.projectViews[projectId] = {
    pageId: resolveSettingsPageId("project", undefined),
    sectionId: "",
  };
}
const view = $derived(
  projectId ? settingsState.projectViews[projectId] : undefined,
);
</script>

{#if projectId && target && project}
  <SettingsCenter
    {target}
    {project}
    bind:pageId={
      () => resolveSettingsPageId("project", view?.pageId),
      (pageId) => {
        settingsState.projectViews[projectId] = {
          ...settingsState.projectViews[projectId],
          pageId: pageId ?? resolveSettingsPageId("project", undefined),
        };
      }
    }
    bind:sectionId={
      () => view?.sectionId ?? "",
      (sectionId) => {
        const current = settingsState.projectViews[projectId];
        settingsState.projectViews[projectId] = {
          pageId:
            current?.pageId ?? resolveSettingsPageId("project", undefined),
          sectionId: sectionId ?? "",
        };
      }
    }
  />
{/if}
