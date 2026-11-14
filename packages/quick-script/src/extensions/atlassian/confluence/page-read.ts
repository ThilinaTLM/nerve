import { jsonObject } from "../shared/http.js";
import { confluenceRequest } from "./client.js";
import { valuesFromConfluenceList } from "./format.js";
import { storageXmlToMarkdown } from "./markdown.js";
import type { SdkEnvironment } from "../../../runtime/sdk-types.js";
import { orWhenUnsupported } from "../../../runtime/sdk-types.js";

/** Display names for account ids in one request; ids it cannot resolve are left out. */
async function userNames(
  env: SdkEnvironment,
  ids: string[],
): Promise<Map<string, string>> {
  const response = await confluenceRequest(await env.confluence(), {
    parse: jsonObject,
    method: "POST",
    path: "/users-bulk",
    body: { accountIds: ids.slice(0, 100) },
    signal: env.context.signal,
  }).catch(orWhenUnsupported((): Record<string, unknown> => ({})));
  const names = new Map<string, string>();
  for (const raw of valuesFromConfluenceList(response)) {
    const user = raw as Record<string, unknown>;
    const name = user.displayName ?? user.publicName;
    if (typeof user.accountId === "string" && typeof name === "string") {
      names.set(user.accountId, name);
    }
  }
  return names;
}

/**
 * Markdown for reading a page: mentions become `@Display Name` (one batched
 * lookup, `@accountId` when unknown), tasks `- [ ]`, statuses `[In progress]`,
 * add-on macros `[drawio macro: name]`.
 */
export async function pageMarkdown(
  env: SdkEnvironment,
  storage: string,
): Promise<string> {
  const markdown = await storageXmlToMarkdown(storage, env.context.signal);
  const ids = [
    ...new Set([...markdown.matchAll(/@\{([^}\s]+)\}/g)].map((m) => m[1])),
  ];
  const names = ids.length > 0 ? await userNames(env, ids) : new Map();
  return markdown.replaceAll(
    /@\{([^}\s]+)\}/g,
    (_m, id: string) => `@${names.get(id) ?? id}`,
  );
}
