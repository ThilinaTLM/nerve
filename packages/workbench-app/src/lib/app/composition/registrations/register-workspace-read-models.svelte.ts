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
import { registerWorkspaceFeatureCommands } from "$lib/application/workspace/workspace-feature-commands";

export function registerWorkspaceReadModels(): void {
  registerWorkspaceFeatureCommands({
    cancelVoiceInputTargets,
    openPendingConversation,
    removeConversationTabs,
  });

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

  registerFileSelectorWorkspaceReadModel({
    get activeCenterTab() {
      return workspaceState.activeCenterTab;
    },
  });

  registerGitSelectorWorkspaceReadModel({
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

  registerTaskSelectorWorkspaceReadModel({
    get activeProjectDir() {
      return workspaceSelectors.activeProject?.dir;
    },
    get activeCenterTab() {
      return workspaceState.activeCenterTab;
    },
  });
}
