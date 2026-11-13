import type { ExtensionView } from "@nervekit/contracts/extensions";
import {
  activeNamespaces,
  displayValue,
  extensionFix,
  namespaceProblem,
  type AccountChoices,
} from "../extensions/extensions-view";
import type { ToolId } from "./tool-settings";

/** Where a tool's setup lives: an extension's detail, or the Extensions list. */
export type ToolSettingsLink = { item?: string };

export function toolSettingsLink(id: ToolId): ToolSettingsLink | undefined {
  switch (id) {
    case "web_search":
    case "web_fetch":
      return { item: "web" };
    case "jira":
    case "confluence":
      return { item: "atlassian" };
    case "kroki_export":
      return { item: "diagram" };
    case "quick_script":
      return {};
    default:
      return undefined;
  }
}

/** What an extension adds to a tool row: its summary, or a problem with a link to fix it. */
export type ToolExtensionState = {
  summary?: string;
  problem?: string;
  fix?: { extensionId: string; label: string; section: string };
  /** The switch cannot be used until the problem is fixed. */
  disabled?: boolean;
};

function accountName(
  extension: ExtensionView,
  key: string,
  accounts: AccountChoices,
): string | undefined {
  const field = extension.settingsSchema.fields[key];
  return field
    ? displayValue(field, extension.fields[key]?.value, accounts)
    : undefined;
}

/**
 * Tool rows whose setup moved to an extension: Web search and fetch follow the
 * Web extension, Jira and Confluence need the Atlassian account, and Quick
 * script lists the namespaces that are on. `undefined` leaves the row alone.
 */
export function toolExtensionState(
  id: ToolId,
  extensions: readonly ExtensionView[] | undefined,
  accounts: AccountChoices,
): ToolExtensionState | undefined {
  if (!extensions) return undefined;
  const find = (extensionId: string) =>
    extensions.find((extension) => extension.metadata.id === extensionId);
  switch (id) {
    case "web_search":
    case "web_fetch": {
      const web = find("web");
      if (!web) return undefined;
      if (!web.enabled.value)
        return {
          disabled: true,
          problem: "Turned off in the Web extension",
          fix: { extensionId: "web", label: "Open Web", section: "settings" },
        };
      if (id === "web_fetch") return undefined;
      const account = accountName(web, "searchAccount", accounts);
      return account
        ? { summary: `Web extension · ${account}` }
        : {
            problem: "No search account selected in the Web extension",
            fix: {
              extensionId: "web",
              label:
                (accounts.tavily?.length ?? 0) > 0
                  ? "Choose account"
                  : "Add account",
              section:
                (accounts.tavily?.length ?? 0) > 0 ? "settings" : "accounts",
            },
          };
    }
    case "jira":
    case "confluence": {
      const atlassian = find("atlassian");
      if (!atlassian) return undefined;
      const account = accountName(atlassian, "account", accounts);
      if (account) return { summary: `Atlassian extension · ${account}` };
      const hasAccounts = (accounts.atlassian?.length ?? 0) > 0;
      return {
        problem: "No Atlassian account selected in the Atlassian extension",
        fix: {
          extensionId: "atlassian",
          label: hasAccounts ? "Choose account" : "Add account",
          section: hasAccounts ? "settings" : "accounts",
        },
      };
    }
    case "quick_script": {
      const problem = namespaceProblem(extensions);
      if (problem) {
        const owner = find(problem.extensionId)!;
        const fix = extensionFix(owner, accounts);
        return {
          problem: problem.text,
          fix: {
            extensionId: problem.extensionId,
            label: fix?.label ?? "Review",
            section: fix?.section ?? "settings",
          },
        };
      }
      return { summary: activeNamespaces(extensions).join(", ") };
    }
    default:
      return undefined;
  }
}
