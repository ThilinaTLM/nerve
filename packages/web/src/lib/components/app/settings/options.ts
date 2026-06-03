export type RadioItem = {
  value: string;
  label: string;
  detail?: string;
  disabled?: boolean;
};

export type SettingsSection =
  | "general"
  | "appearance"
  | "providers"
  | "agents"
  | "network";

export const themeItems: RadioItem[] = [
  { value: "system", label: "System", detail: "Follow the operating system" },
  { value: "dark", label: "Dark", detail: "Technical Precision reference" },
  { value: "light", label: "Light", detail: "Fallback desktop surfaces" },
];

export const modeItems: RadioItem[] = [
  {
    value: "coding",
    label: "Coding",
    detail: "Implement, edit files, and run checks",
  },
  {
    value: "planning",
    label: "Planning",
    detail: "Inspect, reason, and prepare before edits",
  },
];

export const permissionItems: RadioItem[] = [
  {
    value: "read_only",
    label: "Read only",
    detail: "No writes or mutating commands",
  },
  {
    value: "supervised",
    label: "Supervised",
    detail: "Ask before non-read tool calls",
  },
  {
    value: "autonomous",
    label: "Autonomous",
    detail: "Allow tool calls without approval",
  },
];

export const navItems: {
  value: SettingsSection;
  label: string;
  detail: string;
}[] = [
  { value: "general", label: "General", detail: "Daemon and storage" },
  { value: "appearance", label: "Appearance", detail: "Theme surfaces" },
  { value: "providers", label: "Providers", detail: "Credential status" },
  { value: "agents", label: "Agents", detail: "Defaults and policy" },
  { value: "network", label: "Network", detail: "Server binding" },
];
