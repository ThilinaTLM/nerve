// Frozen capability defaults at the 0.34.1 → conversation-core boundary.
export const defaults = {
  disabledTools: [
    "explain_image",
    "generate_image",
    "kroki_export",
    "subagents",
    "jira",
    "confluence",
  ],
  toolProfiles: {},
  toolSettings: {
    explain_image: {
      thinkingLevel: "off",
    },
    generate_image: {
      provider: "openai-codex",
      model: "gpt-image-2.5-flare",
      options: {
        quality: "auto",
        size: "auto",
        background: "auto",
      },
    },
    kroki_export: {
      url: "https://kroki.io/",
    },
  },
  disabledFileSkills: [],
  enabledNerveSkills: [],
  enabledAgentBrowserSkills: [],
};
