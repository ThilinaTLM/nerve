import type { QuickScriptAvailability } from "@nervekit/tools/execution";
import {
  fieldValue,
  type ExtensionResolution,
} from "@nervekit/contracts/extensions";

const SETTINGS = (extension: string) => `Settings → Extensions → ${extension}`;

/** The user's accounts, by kind (`Settings.providers`). */
export type AccountDirectory = {
  atlassianProfiles: readonly { id: string }[];
  tavilyProfiles: readonly { id: string }[];
};

/** What the host knows about stored credentials; absent when only settings are known (the tool description). */
export type ResolvedCredentials = {
  /** The selected Atlassian account has an API token. */
  atlassian?: boolean;
  /** The selected Tavily account has an API key. */
  tavily?: boolean;
};

type State = QuickScriptAvailability[string];
type Product = "jira" | "confluence";

const stringField = (
  resolution: ExtensionResolution,
  extension: string,
  key: string,
): string | undefined => {
  const value = fieldValue(resolution.extensions[extension], key);
  return typeof value === "string" && value ? value : undefined;
};

/** Id of the selected Atlassian account when it exists in the home. */
export function selectedAtlassianAccount(
  resolution: ExtensionResolution,
  accounts: AccountDirectory,
): string | undefined {
  const id = stringField(resolution, "atlassian", "account");
  return id && accounts.atlassianProfiles.some((profile) => profile.id === id)
    ? id
    : undefined;
}

/** Id of the selected Tavily account when it exists in the home. */
export function selectedSearchAccount(
  resolution: ExtensionResolution,
  accounts: AccountDirectory,
): string | undefined {
  const id = stringField(resolution, "web", "searchAccount");
  return id && accounts.tavilyProfiles.some((profile) => profile.id === id)
    ? id
    : undefined;
}

/** Diagram server URL, regardless of the extension switch (the direct tool uses it too). */
export function diagramServer(
  resolution: ExtensionResolution,
): string | undefined {
  return stringField(resolution, "diagram", "server");
}

/**
 * Which `quick_script` extension namespaces are configured and usable, from
 * the resolved extension settings. `configured` follows the switches (it
 * decides what the tool description lists); `available` also needs an existing
 * account and, when `credentials` is given, a saved token. Runtime namespaces
 * are not listed.
 */
export function quickScriptAvailability(
  resolution: ExtensionResolution,
  accounts: AccountDirectory,
  credentials?: ResolvedCredentials,
): QuickScriptAvailability {
  const extensionOn = (id: string) =>
    resolution.extensions[id]?.enabled.value === true;
  const atlassianFix = SETTINGS("Atlassian");
  const product = (name: Product): State => {
    const label = name === "jira" ? "Jira" : "Confluence";
    const on =
      extensionOn("atlassian") &&
      fieldValue(resolution.extensions.atlassian, name) === true;
    if (!on)
      return {
        configured: false,
        available: false,
        reason: `${label} is switched off.`,
        fix: `Ask the user to enable ${label} in ${atlassianFix}.`,
      };
    if (!selectedAtlassianAccount(resolution, accounts))
      return {
        configured: true,
        available: false,
        reason: `no Atlassian account is selected for ${label}, or it no longer exists.`,
        fix: `Ask the user to choose an Atlassian account with a saved API token in ${atlassianFix}.`,
      };
    if (credentials && credentials.atlassian === false)
      return {
        configured: true,
        available: false,
        reason: `the selected Atlassian account has no API token saved.`,
        fix: `Ask the user to check the account and its API token in ${atlassianFix}.`,
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
          fix: `Ask the user to enable one and choose an Atlassian account in ${atlassianFix}.`,
        };
  const web: State = extensionOn("web")
    ? { configured: true, available: true }
    : {
        configured: false,
        available: false,
        reason: "Web is switched off.",
        fix: `Ask the user to enable Web in ${SETTINGS("Web")}.`,
      };
  const diagram: State = extensionOn("diagram")
    ? { configured: true, available: true }
    : {
        configured: false,
        available: false,
        reason: "Diagrams are switched off.",
        fix: `Ask the user to enable Diagrams in ${SETTINGS("Diagrams")}.`,
      };
  return {
    atlassian,
    jira,
    confluence,
    storage: confluence,
    web,
    diagram,
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
