import {
  fieldValue,
  type ExtensionResolution,
} from "@nervekit/contracts/extensions";
import { ToolExecutionError } from "@nervekit/tools/execution";
import type {
  AccountRecord,
  AccountsReader,
} from "../domains/accounts/accounts.service.js";

/*
 * LEGACY until extension-platform S2: what the hand-written built-ins still
 * read from the execution context (`kroki`, `imagegen`, `getApiKey`,
 * `getProviderConfig`, `web`). Extensions built on the extension API get their
 * settings and accounts through `ctx` instead (`extension-ports.ts`); S2
 * deletes this file as each built-in is ported.
 */

type Product = "jira" | "confluence";

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

const stringField = (
  resolution: ExtensionResolution,
  extension: string,
  key: string,
): string | undefined =>
  text(fieldValue(resolution.extensions[extension], key));

/** Diagram server URL, regardless of the extension switch. */
export function diagramServer(
  resolution: ExtensionResolution,
): string | undefined {
  return stringField(resolution, "diagram", "server");
}

/** Resolved settings of the image generation extension, for the execution context. */
export function imagegenSettings(
  resolution: ExtensionResolution,
): Record<string, unknown> {
  return Object.fromEntries(
    ["backend", "model", "quality", "size", "background"].flatMap((key) => {
      const value = stringField(resolution, "imagegen", key);
      return value ? [[key, value]] : [];
    }),
  );
}

/** The Tavily account the Web extension selects, when it exists. */
export async function selectedSearchAccount(
  resolution: ExtensionResolution,
  accounts: Pick<AccountsReader, "get">,
): Promise<AccountRecord | undefined> {
  const id = stringField(resolution, "web", "searchAccount");
  return id ? await accounts.get("tavily", id) : undefined;
}

/** An Atlassian account as the legacy connection loaders read it. */
function atlassianProfile(account: AccountRecord) {
  return {
    id: account.id,
    name: account.name,
    siteUrl: text(account.fields.siteUrl),
    email: text(account.fields.email),
    defaultProjectKey: text(account.fields.defaultProjectKey),
    defaultSpaceKey: text(account.fields.defaultSpaceKey),
  };
}

/**
 * The accounts one tool call signs in with, from the resolved extension
 * settings. `web_search` needs its extension's account up front: missing setup
 * fails the call so the agent can tell the user. `quick_script` instead leaves
 * an unconfigured namespace out; its calls fail with an error naming the
 * setting to fix.
 */
export async function resolveExecutionAccounts(input: {
  toolName: string;
  extensions: ExtensionResolution;
  accounts: AccountsReader;
}) {
  const { toolName, extensions, accounts } = input;
  const quickScript = toolName === "quick_script";
  const direct = toolName === "web_search" ? "tavily" : undefined;
  const extensionOn = (id: string) =>
    extensions.extensions[id]?.enabled.value === true;
  const secret = (kind: string, id: string) =>
    accounts.secret(kind, id).then(
      (value) => value,
      () => undefined,
    );

  const tavilyAccount =
    direct === "tavily" || (quickScript && extensionOn("web"))
      ? await selectedSearchAccount(extensions, accounts)
      : undefined;
  if (direct === "tavily" && !tavilyAccount)
    throw new ToolExecutionError(
      "MISSING_ACCOUNT",
      `${toolName}: no Tavily account is selected for web search. Ask the user to add or choose one in Settings → Extensions → Web.`,
    );
  // quick_script's `web.search` is simply unavailable without a usable token.
  const tavilyKey = tavilyAccount
    ? await secret("tavily", tavilyAccount.id)
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
    : [];
  const atlassianId = stringField(extensions, "atlassian", "account");
  const record =
    atlassianId && products.length
      ? await accounts.get("atlassian", atlassianId)
      : undefined;
  const profile = record ? atlassianProfile(record) : undefined;
  const atlassianKey = record
    ? await secret("atlassian", record.id)
    : undefined;
  const atlassian = new Map<
    Product,
    { profile: NonNullable<typeof profile>; apiKey: string }
  >();
  // quick_script's Jira and Confluence namespaces are simply unavailable without an account and token.
  for (const product of products)
    if (profile && atlassianKey)
      atlassian.set(product, { profile, apiKey: atlassianKey });
  return {
    quickScript,
    extensionOn,
    tavilyAccount,
    tavilyKey,
    atlassianKey,
    atlassianAccounts: atlassian,
  };
}
