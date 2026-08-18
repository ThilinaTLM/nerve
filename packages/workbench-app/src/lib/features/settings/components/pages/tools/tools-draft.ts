import type { Settings } from "$lib/api";

/** Ensures the optional `tools` branch exists before mutating the draft. */
export function ensureToolsDraft(settingsDraft: Settings): Settings["tools"] {
  settingsDraft.tools ??= {
    disabled: ["explain_image"],
    bash: { autoPromotion: { enabled: true, afterMs: 120_000 } },
    jira: { enabled: false },
    confluence: { enabled: false },
    web: {},
    imageExplanation: { thinkingLevel: "off" },
  };
  return settingsDraft.tools;
}
