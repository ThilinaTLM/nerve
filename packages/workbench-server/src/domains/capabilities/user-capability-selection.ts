import {
  capabilityToolsFromDisabledNames,
  type CapabilitySelection,
  type CapabilityToolProfiles,
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
    disabledFileSkills: settings.skills.disabled,
    enabledNerveSkills: settings.skills.nerve.enabled,
    enabledAgentBrowserSkills: settings.skills.agentBrowser.enabled,
  };
}
