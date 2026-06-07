export type RadioItem = {
  value: string;
  label: string;
  detail?: string;
  disabled?: boolean;
};

export const themeItems: RadioItem[] = [
  { value: "system", label: "System", detail: "Follow the operating system" },
  { value: "dark", label: "Dark", detail: "Dark workbench surfaces" },
  { value: "light", label: "Light", detail: "Light workbench surfaces" },
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
