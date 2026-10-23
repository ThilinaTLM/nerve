import {
  agentProfileDraftSchema,
  applyAgentProfileTemplate,
  type AgentProfile,
  type AgentProfileSettings,
} from "@nervekit/contracts/agent-profiles";
import {
  capabilityToolNameSchema,
  capabilityToolPayload,
  capabilityToolSettingsFromSettings,
  capabilityToolsFromDisabledNames,
  type CapabilitySelection,
} from "@nervekit/contracts/capabilities";
import type { ConversationConfig } from "@nervekit/contracts/core";
import { defaultSettings } from "@nervekit/contracts/settings";

/** Application defaults as a selection, for drafts without a loaded one. */
const defaultSelection = (): CapabilitySelection => ({
  disabledTools: [
    ...capabilityToolsFromDisabledNames(defaultSettings.tools.disabled).filter(
      (name) => name !== "bash",
    ),
    ...(defaultSettings.tools.jira.enabled ? [] : (["jira"] as const)),
    ...(defaultSettings.tools.confluence.enabled
      ? []
      : (["confluence"] as const)),
  ],
  toolProfiles: {},
  toolSettings: capabilityToolSettingsFromSettings(defaultSettings),
  disabledFileSkills: defaultSettings.skills.disabled,
  enabledNerveSkills: defaultSettings.skills.nerve.enabled,
  enabledAgentBrowserSkills: defaultSettings.skills.agentBrowser.enabled,
});

/** Draft-only materialization. Never writes preview values back over user choices. */
export function pendingProfilePreview(
  profile: AgentProfile | undefined,
  config: Omit<ConversationConfig, "conversationId">,
  clampThinking: Parameters<
    typeof applyAgentProfileTemplate
  >[2]["clampThinking"],
  selection: CapabilitySelection = defaultSelection(),
  /** Selection without pending overrides: the application settings for tools. */
  baseSelection: CapabilitySelection | undefined = selection,
) {
  if (!profile) return undefined;
  const toolsOf = (source: CapabilitySelection) =>
    Object.fromEntries(
      capabilityToolNameSchema.options.map((name) => [
        name,
        capabilityToolPayload(source, name),
      ]),
    );
  // A draft is initialized from the defaults, so its config stands in for them.
  const applicationSettings: AgentProfileSettings = {
    model: config.model,
    thinking: config.reasoningLevel,
    permission: config.permissionRuleSetId,
    compaction: defaultSettings.compaction,
    tools: toolsOf(baseSelection),
    skills: "none",
  };
  const current: AgentProfileSettings = {
    model: config.model,
    thinking: config.reasoningLevel,
    permission: config.permissionRuleSetId,
    compaction: defaultSettings.compaction,
    tools: toolsOf(selection),
    skills: "none",
  };
  // Resolved profiles include catalog metadata, which is not part of a template.
  const template = agentProfileDraftSchema.parse(
    Object.fromEntries(
      Object.entries(profile).filter(
        ([key]) =>
          !["source", "trust", "path", "digest", "error"].includes(key),
      ),
    ),
  );
  return applyAgentProfileTemplate(template, current, {
    clampThinking,
    settings: applicationSettings,
  });
}
