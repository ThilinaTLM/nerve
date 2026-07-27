export * from "./api/projects.api";
export { default as ProjectNavigatorShell } from "./components/ProjectNavigatorShell.svelte";
export { default as ProjectSwitcher } from "./components/ProjectSwitcher.svelte";
export {
  buildProjectSwitcherItems,
  projectActivityIndicator,
  quickProjectItems,
  summarizeProjectActivity,
} from "./state/project-switcher";
export type {
  ProjectActivityIndicator,
  ProjectActivitySummary,
  ProjectSwitcherItem,
} from "./state/project-switcher";
export {
  focusProjectSearch,
  projectNavigatorSignals,
} from "./state/project-navigator-signals.svelte";
