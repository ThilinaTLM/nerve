export * from "./api/projects.api";
export { default as ConversationsPanelView } from "./components/ConversationsPanelView.svelte";
export { default as ProjectSwitcher } from "./components/ProjectSwitcher.svelte";
export { default as ProjectDirectoryPicker } from "./components/ProjectDirectoryPicker.svelte";
export { default as PruneConversationsDialog } from "./components/PruneConversationsDialog.svelte";
export type {
  DeleteTarget,
  PruneTarget,
  ProjectAgentTreeProps,
} from "./components/project-agent-tree-props";
export {
  buildProjectMenu,
  countAgeEligible,
  countKeepEligible,
  countProjectConversations,
  type ProjectTreeMenuContext,
} from "./components/project-tree-menus";
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
