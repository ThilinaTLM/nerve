import { jsonObject } from "../../atlassian/http.js";
import { confluenceRequest } from "../../confluence/client.js";
import { jiraRequest } from "../../jira/client.js";
import { ToolExecutionError } from "../../errors/tool-error.js";
import {
  defineMethod,
  type SdkEnvironment,
  type SdkMethod,
} from "../sdk-types.js";

type Person = { accountId: string; name: string; email?: string };

const text = (value: unknown) =>
  typeof value === "string" && value ? value : undefined;

/** `undefined` for a product that is not configured; other failures propagate. */
async function ifConfigured<T>(load: () => Promise<T>): Promise<T | undefined> {
  try {
    return await load();
  } catch (error) {
    if (
      error instanceof ToolExecutionError &&
      error.code.endsWith("_NOT_CONFIGURED")
    ) {
      return undefined;
    }
    throw error;
  }
}

async function loadDefaults(env: SdkEnvironment) {
  const signal = env.context.signal;
  const jira = await ifConfigured(async () => {
    const connection = await env.jira();
    const me = await jiraRequest(connection, {
      parse: jsonObject,
      path: "/myself",
      signal,
    });
    return {
      site: connection.siteUrl,
      project: connection.defaultProjectKey,
      user: {
        accountId: String(me.accountId ?? ""),
        name: text(me.displayName) ?? "",
        email: text(me.emailAddress),
      } satisfies Person,
    };
  });
  const confluence = await ifConfigured(async () => {
    const connection = await env.confluence();
    const me = await confluenceRequest(connection, {
      api: "v1",
      parse: jsonObject,
      path: "/user/current",
      signal,
    });
    return {
      site: connection.siteUrl,
      space: connection.defaultSpaceKey,
      user: {
        accountId: String(me.accountId ?? ""),
        name: text(me.displayName) ?? text(me.publicName) ?? "",
        email: text(me.email),
      } satisfies Person,
    };
  });
  if (!jira && !confluence) {
    throw new ToolExecutionError(
      "JIRA_NOT_CONFIGURED",
      "atlassian.defaults: neither Jira nor Confluence is available. Ask the user to enable one and choose an Atlassian account in Settings → Tools → quick_script.",
    );
  }
  return { ...(jira ? { jira } : {}), ...(confluence ? { confluence } : {}) };
}

const cache = new WeakMap<SdkEnvironment, Promise<unknown>>();

export const atlassianMethods: SdkMethod[] = [
  defineMethod({
    product: "atlassian",
    path: "defaults",
    risk: "network",
    options: [],
    signature:
      "/** Configured sites, default project/space and current user; only configured products appear. Cached per run. */ defaults(): Promise<AtlassianDefaults>",
    parse: () => undefined,
    // No dedicated tool: the product reads are the closest, so blocking them blocks this.
    authorize: () => ({
      toolName: "jira_get_project",
      args: {},
      summary: "defaults",
    }),
    authorizeAlso: () => [
      { toolName: "confluence_search_spaces", args: {}, summary: "defaults" },
    ],
    resource: () => "Atlassian defaults",
    run: (_parsed, env) => {
      let result = cache.get(env);
      if (!result) {
        result = loadDefaults(env);
        cache.set(env, result);
      }
      return result;
    },
  }),
];
