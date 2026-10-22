import {
  capabilityToolSettingsFromSettings,
  capabilityToolNameSchema,
  capabilityToolPayload,
  capabilityToolsSchema,
  disabledToolNamesForCapabilities,
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
      ...capabilityToolsFromDisabledNames(tools.disabled).filter(
        (name) => name !== "bash",
      ),
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
    tools: {
      ...settings.tools,
      pythonExec: toolSettings.python_exec,
      bash: toolSettings.bash,
      planPresent: toolSettings.plan_present,
      imageExplanation: toolSettings.explain_image,
      imageGeneration: toolSettings.generate_image,
      kroki: toolSettings.kroki_export,
    },
  };
}

export function canonicalToolsFromSettings(settings: Settings) {
  const selection = userCapabilitySelection(settings);
  return capabilityToolsSchema.parse(
    Object.fromEntries(
      capabilityToolNameSchema.options.map((name) => [
        name,
        capabilityToolPayload(selection, name),
      ]),
    ),
  );
}
export function settingsToolsFromSelection(
  selection: CapabilitySelection,
): Settings["tools"] {
  return {
    disabled: disabledToolNamesForCapabilities(selection.disabledTools),
    pythonExec: selection.toolSettings.python_exec,
    bash: selection.toolSettings.bash,
    planPresent: selection.toolSettings.plan_present,
    imageExplanation: selection.toolSettings.explain_image,
    imageGeneration: selection.toolSettings.generate_image,
    kroki: selection.toolSettings.kroki_export,
    jira: {
      enabled: !selection.disabledTools.includes("jira"),
      profileId: selection.toolProfiles.jira,
    },
    confluence: {
      enabled: !selection.disabledTools.includes("confluence"),
      profileId: selection.toolProfiles.confluence,
    },
    web: { tavilyProfileId: selection.toolProfiles.web_search },
  };
}
