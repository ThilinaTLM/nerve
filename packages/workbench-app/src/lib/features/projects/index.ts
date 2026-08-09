export * from "./api/projects.api";
export { default as ConversationsPanelView } from "./components/ConversationsPanelView.svelte";
export { default as ProjectSwitcher } from "./components/ProjectSwitcher.svelte";
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
