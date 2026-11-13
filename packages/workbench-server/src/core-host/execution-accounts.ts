import type { ExtensionResolution } from "@nervekit/contracts/extensions";
import type { Settings } from "@nervekit/contracts/settings";
import { ToolExecutionError } from "@nervekit/tools/execution";
import {
  selectedAtlassianAccount,
  selectedSearchAccount,
} from "./quick-script-availability.js";

type Providers = Settings["providers"];
type Product = "jira" | "confluence";

/**
 * The accounts one tool call signs in with, from the resolved extension
 * settings. Direct Jira/Confluence/web_search tools need their extension's
 * account up front: missing setup fails the call so the agent can tell the
 * user. `quick_script` instead leaves an unconfigured namespace out; its calls
 * fail with an error naming the setting to fix.
 */
export async function resolveExecutionAccounts(input: {
  toolName: string;
  extensions: ExtensionResolution;
  providers: Providers;
  getApiKey(name: string): Promise<string | undefined>;
}) {
  const { toolName, extensions, providers } = input;
  const quickScript = toolName === "quick_script";
  const direct = toolName.startsWith("jira_")
    ? "jira"
    : toolName.startsWith("confluence_")
      ? "confluence"
      : toolName === "web_search"
        ? "tavily"
        : undefined;
  const extensionOn = (id: string) =>
    extensions.extensions[id]?.enabled.value === true;
  const key = (name: string) =>
    input.getApiKey(name).then(
      (value) => value,
      () => undefined,
    );

  const tavilyId = selectedSearchAccount(extensions, providers);
  const tavilyAccount =
    direct === "tavily" || (quickScript && extensionOn("web"))
      ? providers.tavilyProfiles.find((profile) => profile.id === tavilyId)
      : undefined;
  if (direct === "tavily" && !tavilyAccount)
    throw new ToolExecutionError(
      "MISSING_ACCOUNT",
      `${toolName}: no Tavily account is selected for web search. Ask the user to add or choose one in Settings → Extensions → Web.`,
    );
  // quick_script's `web.search` is simply unavailable without a usable token.
  const tavilyKey = tavilyAccount
    ? await key(`tavily:${tavilyAccount.id}`)
    : undefined;
  if (direct === "tavily" && tavilyAccount && !tavilyKey)
    throw new ToolExecutionError(
      "MISSING_CREDENTIALS",
      `${toolName}: the Tavily account "${tavilyAccount.name}" has no API token saved. Ask the user to add it in Settings → Extensions → Web.`,
    );

  const products: readonly Product[] = quickScript
    ? (["jira", "confluence"] as const).filter(
        (product) =>
          extensionOn("atlassian") &&
          extensions.extensions.atlassian?.fields[product]?.value === true,
      )
    : direct === "jira" || direct === "confluence"
      ? [direct]
      : [];
  const atlassianId = selectedAtlassianAccount(extensions, providers);
  const profile = providers.atlassianProfiles.find(
    (candidate) => candidate.id === atlassianId,
  );
  const atlassianKey =
    profile && products.length
      ? await key(`atlassian:${profile.id}`)
      : undefined;
  const atlassian = new Map<
    Product,
    { profile: (typeof providers.atlassianProfiles)[number]; apiKey: string }
  >();
  for (const product of products) {
    if (!profile) {
      if (quickScript) continue;
      throw new ToolExecutionError(
        "MISSING_ACCOUNT",
        `${toolName}: no Atlassian account is selected. Ask the user to add or choose one in Settings → Extensions → Atlassian.`,
      );
    }
    if (!atlassianKey) {
      if (quickScript) continue;
      throw new ToolExecutionError(
        "MISSING_CREDENTIALS",
        `${toolName}: the Atlassian account "${profile.name}" has no API token saved. Ask the user to add it in Settings → Extensions → Atlassian.`,
      );
    }
    atlassian.set(product, { profile, apiKey: atlassianKey });
  }
  return {
    quickScript,
    extensionOn,
    tavilyAccount,
    tavilyKey,
    atlassianKey,
    atlassianAccounts: atlassian,
  };
}
