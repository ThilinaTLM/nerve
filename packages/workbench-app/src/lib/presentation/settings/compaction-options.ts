import type { SettingsChoice } from "./settings-component-contracts";

export const compactionProfileItems: SettingsChoice[] = [
  {
    value: "aggressive",
    label: "Aggressive",
    detail: "Compact at 70% and retain about 2% recent context",
  },
  {
    value: "balanced",
    label: "Balanced",
    detail: "Compact at 80% and retain about 4% recent context",
  },
  {
    value: "conservative",
    label: "Conservative",
    detail: "Compact at 90% and retain about 8% recent context",
  },
  {
    value: "custom",
    label: "Custom",
    detail: "Choose trigger and recent-context percentages",
  },
];
