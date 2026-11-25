import { SuggestionsPageState } from "./suggestions/suggestions-page-state.svelte";
import type { Project } from "@nervekit/contracts/core";
import type { SettingsScopeTarget } from "$lib/features/settings/registry/settings-scope";
import { observeConversationChannel } from "$lib/application/startup/conversation-connection";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import { refreshPromptSuggestionStatuses } from "$lib/features/prompt-suggestions/state/prompt-suggestions-actions.svelte";
import { agentOverridePointers } from "$lib/features/settings/state/project-page-diffs";
import { PermissionsPageController } from "$lib/features/settings/views/pages/permissions/permissions-page-state.svelte";
import { ExtensionsPageController } from "$lib/features/settings/views/pages/extensions/extensions-page-controller.svelte";
import { StoragePageController } from "$lib/features/settings/views/pages/storage/storage-page-state.svelte";
export function createSettingsPageControllers(deps: {
  /** The immutable target of the view these controllers serve. */
  target: () => SettingsScopeTarget;
  /** The target's project, when it is one and is still known. */
  project: () => Project | undefined;
}) {
  /** The project the unified surface shows: the tab's own, or the open project in a user tab. */
  const targetProjectId = () => {
    const target = deps.target();
    return target.kind === "project" ? target.projectId : deps.project()?.id;
  };
  /** The project's own agent settings and suggestion choices. */
  const agentState = new ScopedAgentState();

  async function loadProjectDiff(): Promise<void> {
    const projectId = targetProjectId();
    if (!projectId) return;
    void agentState.load({ scope: "project", projectId });
    void refreshPromptSuggestionStatuses(projectId);
  }

  /** The Add server dialog of the MCP servers page, opened from its header. */
  let mcpAddOpen = $state(false);

  $effect(() => {
    const projectId = targetProjectId();
    if (projectId) {
      void loadProjectDiff();
      // The Permission rules page of a project tab reads its own controller.
      if (deps.target().kind === "project")
        void permissionsController.load(projectId);
    }
  });

  /** Settings the project stores on a User-only page, whether or not its file is trusted. */
  function projectOverrideCount(page: "general" | "tools"): number {
    return agentOverridePointers(agentState.overrides, page).length;
  }

  $effect(() => {
    const refresh = () =>
      targetProjectId()
        ? Promise.all([loadProjectDiff()]).then(() => undefined)
        : Promise.resolve();
    const stop = observeConversationChannel({
      recover: refresh,
      disconnected() {},
      event() {},
      notice(notice) {
        if (
          notice.type === "agentConfiguration.changed" &&
          notice.data.scope.scope === "project" &&
          notice.data.scope.projectId === targetProjectId()
        )
          void refresh();
      },
    });
    const stopSettings = [
      onEvent("settings.updated", () => void refresh()),
      onEvent("agentProfiles.changed", () => void refresh()),
      onEvent("prompt_suggestions.enabled_updated", () => void refresh()),
    ];
    return () => {
      stop();
      for (const unsubscribe of stopSettings) unsubscribe();
    };
  });
  const storageController = new StoragePageController();
  const permissionsController = new PermissionsPageController();
  const extensionsPageController = new ExtensionsPageController();
  const suggestionsPageState = new SuggestionsPageState();
  return {
    get mcpAddOpen() {
      return mcpAddOpen;
    },
    set mcpAddOpen(value) {
      mcpAddOpen = value;
    },
    projectOverrideCount,
    suggestionsPageState,
    storageController,
    permissionsController,
    extensionsPageController,
  };
}
export type SettingsPageControllers = ReturnType<
  typeof createSettingsPageControllers
>;
