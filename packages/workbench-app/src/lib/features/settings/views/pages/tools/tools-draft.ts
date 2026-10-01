import type { Settings } from "$lib/api";

/** Ensures the optional `tools` branch exists before mutating the draft. */
export function ensureToolsDraft(settingsDraft: Settings): Settings["tools"] {
  settingsDraft.tools ??= {
    disabled: ["explain_image", "generate_image", "kroki_export"],
    bash: { autoPromotion: { enabled: true, afterMs: 120_000 } },
    jira: { enabled: false },
    confluence: { enabled: false },
    web: {},
    kroki: { url: "https://kroki.io/" },
    imageExplanation: { thinkingLevel: "off" },
    imageGeneration: {
      provider: "openai-codex",
      model: "gpt-image-2.5-flare",
      options: { quality: "auto", size: "auto", background: "auto" },
    },
  };
  return settingsDraft.tools;
}
