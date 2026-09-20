export * from "./api/projects.api";
export { default as ProjectIcon } from "./views/ProjectIcon.svelte";
export { default as ProjectSwitcher } from "./views/ProjectSwitcher.svelte";
export { default as PruneConversationsDialog } from "./views/PruneConversationsDialog.svelte";
export type {
  DeleteTarget,
  PruneTarget,
  ProjectAgentTreeProps,
} from "./views/project-agent-tree-props";
export {
  buildConversationMenu,
  buildProjectMenu,
  countAgeEligible,
  countCompletedEligible,
  countKeepEligible,
  countProjectConversations,
  type ProjectTreeMenuContext,
} from "./views/project-tree-menus";
export {
  buildProjectSwitcherItems,
  projectActivitySignal,
  quickProjectItems,
  summarizeProjectActivity,
} from "./state/project-switcher";
export type {
  ProjectActivitySignal,
  ProjectActivitySummary,
  ProjectSwitcherItem,
  ProjectTaskSummary,
} from "./state/project-switcher";
export {
  focusProjectSearch,
  projectNavigatorSignals,
} from "./state/project-navigator-signals.svelte";
export {
  conversationListPreferences,
  setHideCompletedConversations,
} from "./state/conversation-list-preferences.svelte";
