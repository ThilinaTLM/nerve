import type { SettingsChoice } from "$lib/presentation/settings";

export const modeItems: SettingsChoice[] = [
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

export const permissionItems: SettingsChoice[] = [
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

export const compactionProfileItems: SettingsChoice[] = [
  {
    value: "aggressive",
    label: "Aggressive",
    detail: "Compact at 70% and retain about 10% recent context",
  },
  {
    value: "balanced",
    label: "Balanced",
    detail: "Compact at 80% and retain about 15% recent context",
  },
  {
    value: "conservative",
    label: "Conservative",
    detail: "Compact at 90% and retain about 25% recent context",
  },
  {
    value: "custom",
    label: "Custom",
    detail: "Choose trigger and recent-context percentages",
  },
];
