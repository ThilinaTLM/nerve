import { workbenchState } from "$lib/stores/workbench/state.svelte";

/**
 * Compatibility facade for workspace-level state while the legacy workbench
 * store is migrated feature-by-feature.
 */
export const workspaceState = {
  get status() {
    return workbenchState.status;
  },
  set status(value) {
    workbenchState.status = value;
  },
  get config() {
    return workbenchState.config;
  },
  set config(value) {
    workbenchState.config = value;
  },
  get connection() {
    return workbenchState.connection;
  },
  set connection(value) {
    workbenchState.connection = value;
  },
  get error() {
    return workbenchState.error;
  },
  set error(value) {
    workbenchState.error = value;
  },
  get projects() {
    return workbenchState.projects;
  },
  set projects(value) {
    workbenchState.projects = value;
  },
  get conversations() {
    return workbenchState.conversations;
  },
  set conversations(value) {
    workbenchState.conversations = value;
  },
  get agents() {
    return workbenchState.agents;
  },
  set agents(value) {
    workbenchState.agents = value;
  },
  get approvals() {
    return workbenchState.approvals;
  },
  set approvals(value) {
    workbenchState.approvals = value;
  },
  get userQuestions() {
    return workbenchState.userQuestions;
  },
  set userQuestions(value) {
    workbenchState.userQuestions = value;
  },
  get planReviews() {
    return workbenchState.planReviews;
  },
  set planReviews(value) {
    workbenchState.planReviews = value;
  },
  get openCenterTabs() {
    return workbenchState.openCenterTabs;
  },
  set openCenterTabs(value) {
    workbenchState.openCenterTabs = value;
  },
  get activeCenterTab() {
    return workbenchState.activeCenterTab;
  },
  set activeCenterTab(value) {
    workbenchState.activeCenterTab = value;
  },
  get projectPickerOpen() {
    return workbenchState.projectPickerOpen;
  },
  set projectPickerOpen(value) {
    workbenchState.projectPickerOpen = value;
  },
};
