import { jsonObject } from "../shared/http.js";
import { confluenceRequest } from "./client.js";
import { valuesFromConfluenceList } from "./format.js";
import { confluenceStorageToMarkdown } from "./storage-markdown.js";
import type { ConfluenceSession } from "./session.js";
import { orWhenUnsupported } from "../shared/errors.js";

/** Display names for account ids in one request; ids it cannot resolve are left out. */
async function userNames(
  session: ConfluenceSession,
  ids: string[],
): Promise<Map<string, string>> {
  const response = await confluenceRequest(session.connection, {
    parse: jsonObject,
    method: "POST",
    path: "/users-bulk",
    body: { accountIds: ids.slice(0, 100) },
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
  session: ConfluenceSession,
  storage: string,
): Promise<string> {
  const markdown = confluenceStorageToMarkdown(storage);
  const ids = [
    ...new Set([...markdown.matchAll(/@\{([^}\s]+)\}/g)].map((m) => m[1])),
  ];
  const names = ids.length > 0 ? await userNames(session, ids) : new Map();
  return markdown.replaceAll(
    /@\{([^}\s]+)\}/g,
    (_m, id: string) => `@${names.get(id) ?? id}`,
  );
}
