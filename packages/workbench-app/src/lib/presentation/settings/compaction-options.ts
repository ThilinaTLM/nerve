import type { SettingsChoice } from "./settings-component-contracts";

export const compactionProfileItems: SettingsChoice[] = [
  {
    value: "aggressive",
    label: "Aggressive",
    detail: "Compact at 70% and retain about 10,000 recent tokens",
  },
  {
    value: "balanced",
    label: "Balanced",
    detail: "Compact at 80% and retain about 10,000 recent tokens",
  },
  {
    value: "conservative",
    label: "Conservative",
    detail: "Compact at 90% and retain about 10,000 recent tokens",
  },
  {
    value: "custom",
    label: "Custom",
    detail: "Choose the trigger; retains about 10,000 recent tokens",
  },
];
