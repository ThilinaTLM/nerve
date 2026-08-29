import type { SettingsChoice } from "$lib/presentation/settings";

export const themeItems: SettingsChoice[] = [
  { value: "system", label: "System", detail: "Follow the operating system" },
  { value: "dark", label: "Dark", detail: "Dark workbench surfaces" },
  { value: "light", label: "Light", detail: "Light workbench surfaces" },
];
