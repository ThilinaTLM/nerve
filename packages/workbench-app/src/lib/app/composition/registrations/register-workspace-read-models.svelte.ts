import { ConversationListStore } from "$lib/features/conversations/state/core-conversation-list-store.svelte";
import { registerConversationLists } from "$lib/application/workspace/conversation-lists.svelte";
import { cancelVoiceInputTargets } from "$lib/features/conversations/audio/voice-input-session.svelte";
import { registerFileSelectorWorkspaceReadModel } from "$lib/features/filesystem/state/file-selectors.svelte";
import { registerGitSelectorWorkspaceReadModel } from "$lib/features/git/state/git-selectors.svelte";
import { registerTaskSelectorWorkspaceReadModel } from "$lib/features/tasks/state/task-selectors.svelte";
import { workspaceSelectors } from "$lib/application/workspace/workspace-selectors.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import {
  registerWorkspaceFeaturePorts,
  type WorkspaceFeaturePorts,
} from "$lib/application/workspace/workspace-feature-ports.svelte";
import {
  filesystemWorkspaceCommands,
  filesystemWorkspaceReadModel,
} from "$lib/features/filesystem/workspace.svelte";
import {
  gitWorkspaceCommands,
  gitWorkspaceReadModel,
} from "$lib/features/git/workspace.svelte";
import {
  logWorkspaceReadModel,
  setLogWorkspaceTabOpen,
} from "$lib/features/logs/workspace.svelte";
import {
  settingsWorkspaceReadModel,
  setSettingsWorkspaceTabOpen,
} from "$lib/features/settings/workspace.svelte";
import {
  taskWorkspaceCommands,
  taskWorkspaceReadModel,
} from "$lib/features/tasks/workspace.svelte";

export function registerWorkspaceReadModels(): () => void {
  const unregisterLists = registerConversationLists(
    (id) => new ConversationListStore(id),
  );
  const conversations: WorkspaceFeaturePorts["conversations"] = {
    commands: { cancelVoiceInputTargets },
  };
  const unregisterPorts = registerWorkspaceFeaturePorts({
    conversations,
    filesystem: {
      read: filesystemWorkspaceReadModel,
      commands: {
        ...filesystemWorkspaceCommands,
        restoreFileView: (id, view) =>
          filesystemWorkspaceCommands.restoreFileView(
            id,
            view as Parameters<
              typeof filesystemWorkspaceCommands.restoreFileView
            >[1],
          ),
        restoreMermaidView: (id, view) =>
          filesystemWorkspaceCommands.restoreMermaidView(
            id,
            view as Parameters<
              typeof filesystemWorkspaceCommands.restoreMermaidView
            >[1],
          ),
      },
    },
    git: {
      read: gitWorkspaceReadModel,
      commands: {
        ...gitWorkspaceCommands,
        restorePrView: (id, view) =>
          gitWorkspaceCommands.restorePrView(
            id,
            view as Parameters<typeof gitWorkspaceCommands.restorePrView>[1],
          ),
        restoreDiffView: (id, view) =>
          gitWorkspaceCommands.restoreDiffView(
            id,
            view as Parameters<typeof gitWorkspaceCommands.restoreDiffView>[1],
          ),
      },
    },
    logs: {
      read: logWorkspaceReadModel,
      commands: { setTabOpen: setLogWorkspaceTabOpen },
    },
    settings: {
      read: settingsWorkspaceReadModel,
      commands: { setTabOpen: setSettingsWorkspaceTabOpen },
    },
    tasks: { read: taskWorkspaceReadModel, commands: taskWorkspaceCommands },
  });

  const unregisterFileSelectors = registerFileSelectorWorkspaceReadModel({
    get activeCenterTab() {
      return workspaceState.activeCenterTab;
    },
  });

  const unregisterGitSelectors = registerGitSelectorWorkspaceReadModel({
    get activeCenterTab() {
      return workspaceState.activeCenterTab;
    },
    get activeProjectId() {
      return workspaceSelectors.activeProject?.id;
    },
  });

  const unregisterTaskSelectors = registerTaskSelectorWorkspaceReadModel({
    get activeProjectDir() {
      return workspaceSelectors.activeProject?.directory;
    },
    get activeCenterTab() {
      return workspaceState.activeCenterTab;
    },
  });

  return () => {
    unregisterTaskSelectors();
    unregisterGitSelectors();
    unregisterFileSelectors();
    unregisterPorts();
    unregisterLists();
  };
}
