import { cancelVoiceInputTargets } from "$lib/features/conversations/audio/voice-input-session.svelte";
import {
  openPendingConversation,
  removeConversationTabs,
} from "$lib/features/conversations/state/conversation-flow.svelte";
import { registerConversationSelectorWorkspaceReadModel } from "$lib/features/conversations/state/conversation-selectors.svelte";
import { registerFileSelectorWorkspaceReadModel } from "$lib/features/filesystem/state/file-selectors.svelte";
import { registerGitSelectorWorkspaceReadModel } from "$lib/features/git/state/git-selectors.svelte";
import { registerTaskSelectorWorkspaceReadModel } from "$lib/features/tasks/state/task-selectors.svelte";
import { settingsReadModel } from "$lib/application/preferences/settings-read-model.svelte";
import { usageReadModel } from "$lib/application/usage/usage-read-model.svelte";
import { selection } from "$lib/application/workspace/selection.svelte";
import { workspaceSelectors } from "$lib/application/workspace/workspace-selectors.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import {
  registerWorkspaceFeaturePorts,
  type WorkspaceFeaturePorts,
} from "$lib/application/workspace/workspace-feature-ports.svelte";
import { conversationWorkspaceCommands } from "$lib/features/conversations/workspace-commands.svelte";
import { conversationWorkspaceReadModel } from "$lib/features/conversations/workspace-read-model.svelte";
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
  const conversations: WorkspaceFeaturePorts["conversations"] = {
    read: conversationWorkspaceReadModel,
    commands: {
      ...conversationWorkspaceCommands,
      cancelVoiceInputTargets,
      openPendingConversation,
      removeConversationTabs,
    },
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

  const unregisterConversationSelectors =
    registerConversationSelectorWorkspaceReadModel({
      get selectedConversationId() {
        return selection.conversationId;
      },
      get selectedAgentId() {
        return selection.agentId;
      },
      get activeCenterTab() {
        return workspaceState.activeCenterTab;
      },
      get activeProject() {
        return workspaceSelectors.activeProject;
      },
      get activeConversation() {
        return workspaceSelectors.activeConversation;
      },
      get activeAgent() {
        return workspaceSelectors.activeAgent;
      },
      get userQuestions() {
        return workspaceSelectors.userQuestions;
      },
      get planReviews() {
        return workspaceSelectors.planReviews;
      },
      get conversationActivityById() {
        return workspaceSelectors.conversationActivityById;
      },
      get agents() {
        return workspaceState.agents;
      },
      get connection() {
        return workspaceState.connection;
      },
      get models() {
        return settingsReadModel.models;
      },
      get authProviders() {
        return settingsReadModel.authProviders;
      },
      get settingsDraft() {
        return settingsReadModel.settingsDraft;
      },
      get subscriptionUsage() {
        return usageReadModel.subscriptionUsage;
      },
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
    get activeConversationBranchDepth() {
      return workspaceSelectors.activeConversationBranchDepth;
    },
    get agents() {
      return workspaceState.agents;
    },
    get selectedAgentId() {
      return selection.agentId;
    },
  });

  const unregisterTaskSelectors = registerTaskSelectorWorkspaceReadModel({
    get activeProjectDir() {
      return workspaceSelectors.activeProject?.dir;
    },
    get activeCenterTab() {
      return workspaceState.activeCenterTab;
    },
  });

  return () => {
    unregisterTaskSelectors();
    unregisterGitSelectors();
    unregisterFileSelectors();
    unregisterConversationSelectors();
    unregisterPorts();
  };
}
