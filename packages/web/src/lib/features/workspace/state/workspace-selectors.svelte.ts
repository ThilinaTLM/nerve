import { workbenchSelectors } from "$lib/stores/workbench/selectors.svelte";

export const workspaceSelectors = {
  get status() {
    return workbenchSelectors.status;
  },
  get connection() {
    return workbenchSelectors.connection;
  },
  get error() {
    return workbenchSelectors.error;
  },
  get projects() {
    return workbenchSelectors.projects;
  },
  get conversations() {
    return workbenchSelectors.conversations;
  },
  get agents() {
    return workbenchSelectors.agents;
  },
  get approvals() {
    return workbenchSelectors.approvals;
  },
  get centerTabs() {
    return workbenchSelectors.centerTabs;
  },
  get openConversationTabIds() {
    return workbenchSelectors.openConversationTabIds;
  },
  get activeCenterTab() {
    return workbenchSelectors.activeCenterTab;
  },
  get activeProject() {
    return workbenchSelectors.activeProject;
  },
};
