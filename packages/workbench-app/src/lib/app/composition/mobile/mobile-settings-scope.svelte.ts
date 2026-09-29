import type { SettingsScope } from "../settings/settings-page-controllers.svelte";

/** Pages that hold project-scoped controls; the rest are user-only. */
export const PROJECT_SCOPED_SETTINGS_PAGES: readonly string[] = [
  "tools",
  "skills",
  "permissions",
];

/** Settings scope shared by the phone settings index and its pages. */
export const mobileSettingsScope = $state<{ current: SettingsScope }>({
  current: "user",
});
