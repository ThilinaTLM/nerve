import type { SettingsChoice } from "$lib/presentation/settings";

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
