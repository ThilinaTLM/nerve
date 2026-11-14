import type { AccountInfo, ExtensionContext } from "@nervekit/extension-api";
import { ExtensionError } from "@nervekit/extension-api";
import { normalizeSiteUrl } from "../confluence/client.js";
import { jiraSiteUrl } from "../jira/client.js";
import type { ConfluenceConnection } from "../confluence/client.js";
import type { JiraConnection } from "../jira/client.js";
import { ACCOUNT_SETTING } from "./transport.js";

/*
 * Per-run state of the namespaces: the connection (`ctx` plus the account's
 * site) and what the run caches. Created once per `quick_script` run, on first
 * use, by each namespace's `session(ctx)`.
 */

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const NAMES = { jira: "Jira", confluence: "Confluence" } as const;

/** The selected Atlassian account with the fields every request needs; undefined when the setup is incomplete. */
async function selectedAccount(
  ctx: ExtensionContext,
): Promise<(AccountInfo & { site: string; email: string }) | undefined> {
  const account = await ctx.accounts.selected(ACCOUNT_SETTING);
  const site = text(account?.fields.siteUrl);
  const email = text(account?.fields.email);
  return account && site && email ? { ...account, site, email } : undefined;
}

const notAvailable = (product: "jira" | "confluence") =>
  new ExtensionError(
    "BAD_REQUEST",
    `${product}: not available in quick_script. Ask the user to enable ${NAMES[product]} and choose an Atlassian account with a saved API token in Settings → Extensions → Atlassian.`,
  );

function jiraOf(
  ctx: ExtensionContext,
  account: AccountInfo & { site: string },
): JiraConnection {
  const defaultProjectKey = text(account.fields.defaultProjectKey);
  return {
    ctx,
    siteUrl: jiraSiteUrl(account.site),
    ...(defaultProjectKey ? { defaultProjectKey } : {}),
  };
}

function confluenceOf(
  ctx: ExtensionContext,
  account: AccountInfo & { site: string },
): ConfluenceConnection {
  const defaultSpaceKey = text(account.fields.defaultSpaceKey);
  return {
    ctx,
    siteUrl: normalizeSiteUrl(account.site),
    ...(defaultSpaceKey ? { defaultSpaceKey } : {}),
  };
}

/** The Jira connection of the selected account; fails naming the setting to fix. */
export async function jiraConnection(
  ctx: ExtensionContext,
): Promise<JiraConnection> {
  const account = await selectedAccount(ctx);
  if (!account) throw notAvailable("jira");
  return jiraOf(ctx, account);
}

export async function confluenceConnection(
  ctx: ExtensionContext,
): Promise<ConfluenceConnection> {
  const account = await selectedAccount(ctx);
  if (!account) throw notAvailable("confluence");
  return confluenceOf(ctx, account);
}

/** The connections the account and the product switches allow: a product that is off or has no usable account is absent. */
export async function configuredConnections(ctx: ExtensionContext): Promise<{
  jira?: JiraConnection;
  confluence?: ConfluenceConnection;
}> {
  const account = await selectedAccount(ctx);
  if (!account) return {};
  return {
    ...(ctx.settings.get<boolean>("jira") === true
      ? { jira: jiraOf(ctx, account) }
      : {}),
    ...(ctx.settings.get<boolean>("confluence") === true
      ? { confluence: confluenceOf(ctx, account) }
      : {}),
  };
}
