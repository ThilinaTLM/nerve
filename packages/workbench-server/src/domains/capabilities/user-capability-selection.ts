import {
  capabilityToolSettingsFromSettings,
  capabilityToolsFromDisabledNames,
  type CapabilitySelection,
  type CapabilityToolProfiles,
  type CapabilityToolSettings,
} from "@nervekit/contracts/capabilities";
import type { Settings } from "@nervekit/contracts/settings";

/** The user level of the capability ladder, projected from user settings. */
export function userCapabilitySelection(
  settings: Settings,
): CapabilitySelection {
  const tools = settings.tools;
  // Protocol results reject undefined properties, so unset profiles are omitted.
  const toolProfiles: CapabilityToolProfiles = {};
  if (tools.jira.profileId) toolProfiles.jira = tools.jira.profileId;
  if (tools.confluence.profileId)
    toolProfiles.confluence = tools.confluence.profileId;
  if (tools.web.tavilyProfileId)
    toolProfiles.web_search = tools.web.tavilyProfileId;
  return {
    disabledTools: [
      ...capabilityToolsFromDisabledNames(tools.disabled),
      ...(tools.jira.enabled ? [] : (["jira"] as const)),
      ...(tools.confluence.enabled ? [] : (["confluence"] as const)),
    ],
    toolProfiles,
    toolSettings: capabilityToolSettingsFromSettings(settings),
    disabledFileSkills: settings.skills.disabled,
    enabledNerveSkills: settings.skills.nerve.enabled,
    enabledAgentBrowserSkills: settings.skills.agentBrowser.enabled,
  };
}

/** Settings as a tool sees them once a scope's tool settings are applied. */
export function settingsWithCapabilityToolSettings(
  settings: Settings,
  toolSettings: CapabilityToolSettings,
): Settings {
  return {
    ...settings,
    exploreAgent: toolSettings.explore,
    asyncSubagent: toolSettings.subagents,
    tools: {
      ...settings.tools,
      imageExplanation: toolSettings.explain_image,
      imageGeneration: toolSettings.generate_image,
      kroki: toolSettings.kroki_export,
    },
  };
}
