import {
  isArray,
  isString,
  jsonArray,
  jsonObject,
  objectWithFields,
} from "../atlassian/http.js";
import type { IntegrationExecutionContext } from "../execution-context.js";
import { adfToMarkdown } from "../jira/adf-markdown.js";
import {
  type JiraConnection,
  jiraRequest,
  pathSegment,
  requireJiraConnection,
} from "../jira/client.js";
import { jiraUsersFromResponse, searchJiraUsers } from "../jira/users.js";
import {
  DEFAULT_GET_FIELDS,
  DEFAULT_SEARCH_FIELDS,
  defaultSelection,
  flattenIssue,
  type JiraFieldInfo,
  resolveFieldSelection,
  userOf,
} from "./jira-issue.js";

/**
 * The SDK in one place: every method's agent-facing signature, the direct tool
 * it is authorized as, and its implementation. The prelude injected into the
 * sandbox and the tool description's SDK index are both generated from this
 * table, so docs cannot drift from the dispatcher.
 */

/** What a method is authorized as: the equivalent direct tool call. */
export type NestedAuthorization = {
  toolName: string;
  args: Record<string, unknown>;
  /** Short label for the record (JQL, issue key, ...). */
  summary: string;
};

export type SdkEnvironment = {
  context: IntegrationExecutionContext;
  connection: () => Promise<JiraConnection>;
  fields: () => Promise<JiraFieldInfo[]>;
};

type SdkMethod = {
  /** Dotted path under `jira`, e.g. `issues.search`. */
  path: string;
  /** One-line signature for the tool description. */
  signature: string;
  authorize(args: unknown[]): NestedAuthorization;
  run(args: unknown[], env: SdkEnvironment): Promise<unknown>;
};

const MAX_SEARCH_LIMIT = 1000;
const DEFAULT_SEARCH_LIMIT = 50;
const SEARCH_PAGE_SIZE = 100;
const MAX_COMMENTS = 1000;

const parseSearchPage = objectWithFields<{
  issues?: unknown[];
  nextPageToken?: string;
}>({ issues: isArray, nextPageToken: isString });

function stringArg(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function optionsArg(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("options must be an object.");
  }
  return value as Record<string, unknown>;
}

function fieldsOption(options: Record<string, unknown>): string[] | undefined {
  const value = options.fields;
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("fields must be an array of field names or ids.");
  }
  return value as string[];
}

async function selectFields(
  requested: string[] | undefined,
  defaults: readonly string[],
  env: SdkEnvironment,
) {
  return requested
    ? await resolveFieldSelection(requested, env.fields)
    : defaultSelection(defaults);
}

const methods: SdkMethod[] = [
  {
    path: "issues.search",
    signature:
      "issues.search({ jql, fields?, limit? }): Promise<Issue[]>  // limit default 50, max 1000",
    authorize: ([input]) => {
      const jql = stringArg(optionsArg(input).jql, "jql");
      return { toolName: "jira_search_issues", args: { jql }, summary: jql };
    },
    async run([input], env) {
      const options = optionsArg(input);
      const jql = stringArg(options.jql, "jql");
      const limit = clampInt(
        options.limit,
        DEFAULT_SEARCH_LIMIT,
        1,
        MAX_SEARCH_LIMIT,
      );
      const selection = await selectFields(
        fieldsOption(options),
        DEFAULT_SEARCH_FIELDS,
        env,
      );
      const connection = await env.connection();
      const issues: Record<string, unknown>[] = [];
      let nextPageToken: string | undefined;
      do {
        const page = await jiraRequest(connection, {
          parse: parseSearchPage,
          method: "POST",
          path: "/search/jql",
          body: {
            jql,
            fields: selection.map((field) => field.id),
            maxResults: Math.min(SEARCH_PAGE_SIZE, limit - issues.length),
            ...(nextPageToken ? { nextPageToken } : {}),
          },
          signal: env.context.signal,
        });
        for (const raw of page.issues ?? []) {
          if (issues.length >= limit) break;
          issues.push(flattenIssue(raw, connection.siteUrl, selection));
        }
        nextPageToken = page.nextPageToken;
      } while (nextPageToken && issues.length < limit);
      return issues;
    },
  },
  {
    path: "issues.get",
    signature:
      "issues.get(key, { fields?, comments? }): Promise<Issue & { comments? }>",
    authorize: ([key]) => {
      const issueKey = stringArg(key, "key");
      return {
        toolName: "jira_get_issue",
        args: { issue_key: issueKey },
        summary: issueKey,
      };
    },
    async run([key, input], env) {
      const issueKey = stringArg(key, "key");
      const options = optionsArg(input);
      const selection = await selectFields(
        fieldsOption(options),
        DEFAULT_GET_FIELDS,
        env,
      );
      const connection = await env.connection();
      const raw = await jiraRequest(connection, {
        parse: jsonObject,
        path: `/issue/${pathSegment(issueKey)}`,
        query: { fields: selection.map((field) => field.id) },
        signal: env.context.signal,
      });
      const issue = flattenIssue(raw, connection.siteUrl, selection);
      if (options.comments === true) {
        issue.comments = await fetchComments(connection, issueKey, env);
      }
      return issue;
    },
  },
  {
    path: "projects.get",
    signature:
      "projects.get(key): Promise<{ key, name, lead, issueTypes, components, versions }>",
    authorize: ([key]) => {
      const projectKey = stringArg(key, "key");
      return {
        toolName: "jira_get_project",
        args: { project_key: projectKey },
        summary: projectKey,
      };
    },
    async run([key], env) {
      const projectKey = stringArg(key, "key");
      const project = await jiraRequest(await env.connection(), {
        parse: jsonObject,
        path: `/project/${pathSegment(projectKey)}`,
        signal: env.context.signal,
      });
      return {
        key: project.key ?? projectKey,
        name: project.name ?? null,
        lead: userOf(project.lead),
        issueTypes: namesOf(project.issueTypes),
        components: namesOf(project.components),
        versions: namesOf(project.versions),
      };
    },
  },
  {
    path: "users.search",
    signature:
      "users.search(query): Promise<{ accountId, name, email, active }[]>",
    authorize: ([query]) => {
      const text = stringArg(query, "query");
      return {
        toolName: "jira_search_users",
        args: { query: text },
        summary: text,
      };
    },
    async run([query], env) {
      const response = await searchJiraUsers(await env.connection(), {
        query: stringArg(query, "query"),
        maxResults: 50,
        signal: env.context.signal,
      });
      return jiraUsersFromResponse(response).map((raw) => {
        const user = (raw ?? {}) as Record<string, unknown>;
        return {
          accountId: user.accountId ?? null,
          name: user.displayName ?? null,
          email: user.emailAddress ?? null,
          active: user.active !== false,
        };
      });
    },
  },
  {
    path: "fields.list",
    signature:
      "fields.list(): Promise<{ id, name, custom, type }[]>  // names usable in `fields`",
    // There is no dedicated field-listing tool. `jira_get_project` with
    // `include: ["fields"]` is the closest direct read of field metadata, so a
    // policy that allows project reads allows this, and one that blocks Jira
    // reads blocks it.
    authorize: () => ({
      toolName: "jira_get_project",
      args: { include: ["fields"] },
      summary: "all fields",
    }),
    run: (_args, env) => env.fields(),
  },
];

async function fetchComments(
  connection: JiraConnection,
  issueKey: string,
  env: SdkEnvironment,
) {
  const comments: Array<{
    author: string | null;
    created: unknown;
    body: string;
  }> = [];
  let startAt = 0;
  while (comments.length < MAX_COMMENTS) {
    const page = await jiraRequest(connection, {
      parse: jsonObject,
      path: `/issue/${pathSegment(issueKey)}/comment`,
      query: { startAt, maxResults: 100, orderBy: "created" },
      signal: env.context.signal,
    });
    const batch = Array.isArray(page.comments) ? page.comments : [];
    for (const raw of batch) {
      const comment = (raw ?? {}) as Record<string, unknown>;
      comments.push({
        author: userOf(comment.author)?.name ?? null,
        created: comment.created ?? null,
        body: adfToMarkdown(comment.body),
      });
    }
    startAt += batch.length;
    const total = typeof page.total === "number" ? page.total : startAt;
    if (batch.length === 0 || startAt >= total) break;
  }
  return comments;
}

/** Loads the site's field list once per script run. */
export function createSdkEnvironment(
  context: IntegrationExecutionContext,
): SdkEnvironment {
  let connection: Promise<JiraConnection> | undefined;
  let fields: Promise<JiraFieldInfo[]> | undefined;
  const env: SdkEnvironment = {
    context,
    connection: () => (connection ??= requireJiraConnection(context)),
    fields: () =>
      (fields ??= env.connection().then(async (conn) => {
        const raw = await jiraRequest(conn, {
          parse: jsonArray,
          path: "/field",
          signal: context.signal,
        });
        return raw.map((item) => {
          const field = (item ?? {}) as Record<string, unknown>;
          const schema = (field.schema ?? {}) as Record<string, unknown>;
          return {
            id: String(field.id ?? ""),
            name: String(field.name ?? ""),
            custom: field.custom === true,
            type: typeof schema.type === "string" ? schema.type : null,
          };
        });
      })),
  };
  return env;
}

function namesOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const name = (item as { name?: unknown } | null)?.name;
        return typeof name === "string" ? [name] : [];
      })
    : [];
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

const methodByName = new Map<string, SdkMethod>(
  methods.map((method) => [`jira.${method.path}`, method]),
);

export function findSdkMethod(name: string): SdkMethod | undefined {
  return methodByName.get(name);
}

export function sdkMethodNames(): string[] {
  return [...methodByName.keys()];
}

/** Trusted prelude: `jira.*` forwards positional arguments to `host.call`. */
export const SDK_PRELUDE = `globalThis.jira = {
${methods
  .map((method) => {
    const [group, name] = method.path.split(".");
    return { group, name, method };
  })
  .reduce<string[]>((lines, { group, name, method }, index, all) => {
    if (all[index - 1]?.group !== group) lines.push(`  ${group}: {`);
    lines.push(
      `    ${name}: (...args) => host.call("jira.${method.path}", args),`,
    );
    if (all[index + 1]?.group !== group) lines.push("  },");
    return lines;
  }, [])
  .join("\n")}
};`;

/** Compact SDK index for the tool description. */
export const SDK_INDEX = methods
  .map((method) => `jira.${method.signature}`)
  .join("\n");
