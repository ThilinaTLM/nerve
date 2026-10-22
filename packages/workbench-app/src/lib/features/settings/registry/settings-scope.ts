/**
 * What a settings view edits. Resolved once when a settings tab or screen
 * opens and passed down unchanged, so a save can never land on another project
 * because the active project changed underneath it.
 */
export type SettingsScopeTarget =
  | { readonly kind: "user" }
  | { readonly kind: "project"; readonly projectId: string };

export const userSettingsScope: SettingsScopeTarget = Object.freeze({
  kind: "user",
});

export function projectSettingsScope(projectId: string): SettingsScopeTarget {
  return Object.freeze({ kind: "project", projectId });
}

export function settingsScopeKey(target: SettingsScopeTarget): string {
  return target.kind === "user" ? "user" : `project:${target.projectId}`;
}

export function settingsScopesEqual(
  a: SettingsScopeTarget,
  b: SettingsScopeTarget,
): boolean {
  return settingsScopeKey(a) === settingsScopeKey(b);
}
