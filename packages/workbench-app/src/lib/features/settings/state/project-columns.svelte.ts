import {
  loadProjectColumnPreferences,
  persistProjectColumnPreferences,
  type ProjectColumnPage,
} from "./project-columns";

/** Which User-only settings pages (General, Tools) show the project's column. */
export const projectColumns = $state(loadProjectColumnPreferences());

export function setProjectColumn(
  page: ProjectColumnPage,
  shown: boolean,
): void {
  projectColumns[page] = shown;
  persistProjectColumnPreferences($state.snapshot(projectColumns));
}
