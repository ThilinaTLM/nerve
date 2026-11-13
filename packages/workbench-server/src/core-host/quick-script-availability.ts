import type { QuickScriptAvailability } from "@nervekit/tools/execution";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";

const SETTINGS = "Settings → Tools → quick_script";

/** What the host knows about stored credentials; absent when only settings are known (the tool description). */
export type ResolvedCredentials = {
  jira?: boolean;
  confluence?: boolean;
};

type Product = "jira" | "confluence";
type State = QuickScriptAvailability[string];

/**
 * Which `quick_script` extension namespaces are configured and usable, from the
 * agent settings. `configured` follows the switch (it decides what the tool
 * description lists); `available` also needs an existing account and, when
 * `credentials` is given, a saved token. Runtime namespaces are not listed.
 */
export function quickScriptAvailability(
  settings: LeadSettingsOverrides,
  missingReferences: readonly string[],
  credentials?: ResolvedCredentials,
): QuickScriptAvailability {
  const configured = settings.tools?.quick_script?.settings;
  const product = (name: Product): State => {
    const label = name === "jira" ? "Jira" : "Confluence";
    const enabled = configured?.[name]?.enabled === true;
    if (!enabled)
      return {
        configured: false,
        available: false,
        reason: `${label} is switched off for quick_script.`,
        fix: `Ask the user to enable ${label} in ${SETTINGS}.`,
      };
    const profileId = configured?.[name]?.profileId;
    if (
      !profileId ||
      missingReferences.includes(
        `/tools/quick_script/settings/${name}/profileId`,
      )
    )
      return {
        configured: true,
        available: false,
        reason: `no Atlassian account is selected for ${label}.`,
        fix: `Ask the user to choose an Atlassian account with a saved API token in ${SETTINGS}.`,
      };
    if (credentials && credentials[name] === false)
      return {
        configured: true,
        available: false,
        reason: `the selected Atlassian account is missing or has no API token saved.`,
        fix: "Ask the user to check the account and its API token in Settings → Integrations → Atlassian.",
      };
    return { configured: true, available: true };
  };
  const jira = product("jira");
  const confluence = product("confluence");
  const atlassian: State =
    jira.available || confluence.available
      ? { configured: true, available: true }
      : {
          configured: jira.configured || confluence.configured,
          available: false,
          reason: "neither Jira nor Confluence is available.",
          fix: `Ask the user to enable one and choose an Atlassian account in ${SETTINGS}.`,
        };
  const webEnabled = configured?.web?.enabled === true;
  const web: State = webEnabled
    ? { configured: true, available: true }
    : {
        configured: false,
        available: false,
        reason: "Web is switched off for quick_script.",
        fix: `Ask the user to enable Web in ${SETTINGS}.`,
      };
  return {
    atlassian,
    jira,
    confluence,
    storage: confluence,
    web,
    diagram: { configured: true, available: true },
  };
}

/** Ids of the configured namespaces, for the tool description. */
export function configuredNamespaces(
  availability: QuickScriptAvailability,
): string[] {
  return Object.entries(availability)
    .filter(([, state]) => state.configured)
    .map(([id]) => id);
}
