import type { ExtensionContext } from "@nervekit/extension-api";
import { ExtensionError } from "@nervekit/extension-api";
import { jsonObject } from "./http.js";
import { confluenceRequest } from "../confluence/client.js";
import { jiraRequest } from "../jira/client.js";
import { configuredConnections } from "./session.js";
import { defineMethod, type PathedMethod } from "./define-method.js";

type Person = { accountId: string; name: string; email?: string };

const text = (value: unknown) =>
  typeof value === "string" && value ? value : undefined;

/** The per-run state of the `atlassian` namespace: the defaults, loaded once. */
export class AtlassianSession {
  #defaults: Promise<unknown> | undefined;

  constructor(readonly ctx: ExtensionContext) {}

  static create(ctx: ExtensionContext): AtlassianSession {
    return new AtlassianSession(ctx);
  }

  defaults(): Promise<unknown> {
    return (this.#defaults ??= loadDefaults(this.ctx));
  }
}

async function loadDefaults(ctx: ExtensionContext) {
  const { jira: jiraConnection, confluence: confluenceConnection } =
    await configuredConnections(ctx);
  const jira =
    jiraConnection &&
    (await (async () => {
      const me = await jiraRequest(jiraConnection, {
        parse: jsonObject,
        path: "/myself",
      });
      return {
        site: jiraConnection.siteUrl,
        project: jiraConnection.defaultProjectKey,
        user: {
          accountId: String(me.accountId ?? ""),
          name: text(me.displayName) ?? "",
          email: text(me.emailAddress),
        } satisfies Person,
      };
    })());
  const confluence =
    confluenceConnection &&
    (await (async () => {
      const me = await confluenceRequest(confluenceConnection, {
        api: "v1",
        parse: jsonObject,
        path: "/user/current",
      });
      return {
        site: confluenceConnection.siteUrl,
        space: confluenceConnection.defaultSpaceKey,
        user: {
          accountId: String(me.accountId ?? ""),
          name: text(me.displayName) ?? text(me.publicName) ?? "",
          email: text(me.email),
        } satisfies Person,
      };
    })());
  if (!jira && !confluence) {
    throw new ExtensionError(
      "BAD_REQUEST",
      "atlassian.defaults: neither Jira nor Confluence is available. Ask the user to enable one and choose an Atlassian account in Settings → Extensions → Atlassian.",
    );
  }
  return { ...(jira ? { jira } : {}), ...(confluence ? { confluence } : {}) };
}

export const atlassianMethods: PathedMethod<AtlassianSession>[] = [
  defineMethod({
    product: "atlassian",
    path: "defaults",
    risk: "network",
    options: [],
    signature:
      "/** Configured sites, default project/space and current user; only configured products appear. Cached per run. */ defaults(): Promise<AtlassianDefaults>",
    parse: () => undefined,
    // Reads both products, so each product's read operation is checked: blocking either blocks this.
    authorize: () => ({
      operation: "jira.projects.list",
      targets: [],
      summary: "defaults",
    }),
    authorizeAlso: () => [
      {
        operation: "confluence.spaces.search",
        targets: [],
        summary: "defaults",
      },
    ],
    resource: () => "Atlassian defaults",
    run: (_parsed, session) => session.defaults(),
  }),
];
