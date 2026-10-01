import { defaultSettings } from "@nervekit/contracts/settings";
import type { Settings } from "$lib/api";

/** Ensures the optional `tools` branch exists before mutating the draft. */
export function ensureToolsDraft(settingsDraft: Settings): Settings["tools"] {
  settingsDraft.tools ??= structuredClone(defaultSettings.tools);
  return settingsDraft.tools;
}
