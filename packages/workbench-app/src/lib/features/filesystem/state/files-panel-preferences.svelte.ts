import {
  loadFilesPanelPreferences,
  persistFilesPanelPreferences,
  type FilesPanelPreferences,
} from "./files-panel-preferences";

export const filesPanelPreferences = $state(loadFilesPanelPreferences());

export function setFilesPanelPreference<K extends keyof FilesPanelPreferences>(
  key: K,
  value: FilesPanelPreferences[K],
): void {
  filesPanelPreferences[key] = value;
  persistFilesPanelPreferences(filesPanelPreferences);
}
