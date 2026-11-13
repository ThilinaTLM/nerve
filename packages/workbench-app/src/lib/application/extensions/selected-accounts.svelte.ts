import type { ExtensionsView } from "@nervekit/contracts/extensions";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

/**
 * The accounts the user's extension settings select, for features outside the
 * Extensions page (setup guides, Jira and Confluence links). Kept current by
 * `publishUserExtensions`, which every user-scope load and save calls.
 */
const selected = $state<{ atlassian?: string; search?: string }>({});

function accountOf(
  view: ExtensionsView,
  extensionId: string,
  key: string,
): string | undefined {
  const value = view.extensions.find(
    (extension) => extension.metadata.id === extensionId,
  )?.fields[key]?.value;
  return typeof value === "string" && value ? value : undefined;
}

export function publishUserExtensions(view: ExtensionsView): void {
  if (view.target.scope !== "user") return;
  selected.atlassian = accountOf(view, "atlassian", "account");
  selected.search = accountOf(view, "web", "searchAccount");
}

/** Id of the Atlassian account the user selected, if any. */
export function selectedAtlassianAccountId(): string | undefined {
  return selected.atlassian;
}

/** Id of the Tavily account web search uses, if any. */
export function selectedSearchAccountId(): string | undefined {
  return selected.search;
}

export async function refreshSelectedAccounts(): Promise<void> {
  publishUserExtensions(
    await requestWorkbench("extensions.get", { target: { scope: "user" } }),
  );
}
