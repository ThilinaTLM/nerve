import {
  isArray,
  isString,
  jsonArray,
  jsonObject,
  objectWithFields,
} from "../atlassian/http.js";
import type { IntegrationExecutionContext } from "../execution-context.js";
import {
  type JiraConnection,
  jiraRawRequest,
  jiraRequest,
  pathSegment,
  requireJiraConnection,
} from "../jira/client.js";
import { rawMethod } from "../atlassian/raw-request.js";
import { jiraUsersFromResponse, searchJiraUsers } from "../jira/users.js";
import {
  DEFAULT_GET_FIELDS,
  DEFAULT_SEARCH_FIELDS,
  defaultSelection,
  flattenIssue,
  type JiraFieldInfo,
  resolveFieldSelection,
  simplifyComment,
  userOf,
} from "./jira-issue.js";
import { clampInt, nonEmptyString } from "./sdk-args.js";
import {
  defineMethod,
  definePositionalMethod,
  type SdkEnvironment,
  type SdkMethod,
} from "./sdk-types.js";

const MAX_SEARCH_LIMIT = 1000;
const DEFAULT_SEARCH_LIMIT = 50;
const SEARCH_PAGE_SIZE = 100;
const MAX_COMMENTS = 1000;

const parseSearchPage = objectWithFields<{
  issues?: unknown[];
  nextPageToken?: string;
}>({ issues: isArray, nextPageToken: isString });

function fieldsOption(options: Record<string, unknown>): string[] | undefined {
  const value = options.fields;
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("fields must be an array of field names or ids.");
  }
  return value as string[];
}

function selectFields(
  requested: string[] | undefined,
  defaults: readonly string[],
  env: SdkEnvironment,
) {
  return requested
    ? resolveFieldSelection(requested, env.jiraFields)
    : Promise.resolve(defaultSelection(defaults));
}

export const jiraMethods: SdkMethod[] = [
  defineMethod({
    product: "jira",
    path: "issues.search",
    bare: "jql",
    options: ["jql", "fields", "limit"],
    signature:
      "issues.search({ jql, fields?, limit? }): Promise<Issue[]>  // limit default 50, max 1000",
    parse: (options) => ({
      jql: nonEmptyString(options.jql, "jql"),
      limit: clampInt(options.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT),
      fields: fieldsOption(options),
    }),
    authorize: ({ jql }) => ({
      toolName: "jira_search_issues",
      args: { jql },
      summary: jql,
    }),
    resource: () => "this Jira search",
    async run({ jql, limit, fields }, env) {
      const selection = await selectFields(fields, DEFAULT_SEARCH_FIELDS, env);
      const connection = await env.jira();
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
  }),
  defineMethod({
    product: "jira",
    path: "issues.get",
    bare: "key",
    options: ["key", "fields", "comments"],
    signature:
      "issues.get({ key, fields?, comments? }): Promise<Issue & { comments? }>",
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      fields: fieldsOption(options),
      comments: options.comments === true,
    }),
    authorize: ({ key }) => ({
      toolName: "jira_get_issue",
      args: { issue_key: key },
      summary: key,
    }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, fields, comments }, env) {
      const selection = await selectFields(fields, DEFAULT_GET_FIELDS, env);
      const connection = await env.jira();
      const raw = await jiraRequest(connection, {
        parse: jsonObject,
        path: `/issue/${pathSegment(key)}`,
        query: { fields: selection.map((field) => field.id) },
        signal: env.context.signal,
      });
      const issue = flattenIssue(raw, connection.siteUrl, selection);
      if (comments) issue.comments = await fetchComments(connection, key, env);
      return issue;
    },
  }),
  defineMethod({
    product: "jira",
    path: "projects.get",
    bare: "key",
    options: ["key"],
    signature:
      "projects.get({ key }): Promise<{ key, name, lead, issueTypes, components, versions }>",
    parse: (options) => nonEmptyString(options.key, "key"),
    authorize: (key) => ({
      toolName: "jira_get_project",
      args: { project_key: key },
      summary: key,
    }),
    resource: (key) => `project ${key}`,
    async run(key, env) {
      const project = await jiraRequest(await env.jira(), {
        parse: jsonObject,
        path: `/project/${pathSegment(key)}`,
        signal: env.context.signal,
      });
      return {
        key: project.key ?? key,
        name: project.name ?? null,
        lead: userOf(project.lead),
        issueTypes: namesOf(project.issueTypes),
        components: namesOf(project.components),
        versions: namesOf(project.versions),
      };
    },
  }),
  defineMethod({
    product: "jira",
    path: "users.search",
    bare: "query",
    options: ["query"],
    signature:
      "users.search({ query }): Promise<{ accountId, name, email, active }[]>",
    parse: (options) => nonEmptyString(options.query, "query"),
    authorize: (query) => ({
      toolName: "jira_search_users",
      args: { query },
      summary: query,
    }),
    resource: () => "Jira users",
    async run(query, env) {
      const response = await searchJiraUsers(await env.jira(), {
        query,
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
  }),
  defineMethod({
    product: "jira",
    path: "fields.list",
    options: [],
    signature:
      "fields.list(): Promise<{ id, name, custom, type }[]>  // names usable in `fields`",
    parse: () => undefined,
    // There is no dedicated field-listing tool. `jira_get_project` with
    // `include: ["fields"]` is the closest direct read of field metadata, so a
    // policy that allows project reads allows this, and one that blocks Jira
    // reads blocks it.
    authorize: () => ({
      toolName: "jira_get_project",
      args: { include: ["fields"] },
      summary: "all fields",
    }),
    resource: () => "Jira fields",
    run: (_parsed, env) => env.jiraFields(),
  }),
  definePositionalMethod({
    product: "jira",
    path: "request",
    maxArgs: 3,
    signature:
      "request(method, path, body?): Promise<unknown>  // path under /rest/api/3/ or /rest/agile/1.0/; JSON (or text), max 5 MB",
    parse: ([method, path, body]) => ({
      method: rawMethod(method),
      path,
      body,
    }),
    // GET is a read; anything else is checked like the destructive `jira_manage_*` tools.
    authorize: ({ method, path }) => ({
      toolName: method === "GET" ? "jira_get_project" : "jira_manage_comment",
      args: { method, path },
      summary: `${method} ${String(path)}`,
    }),
    resource: ({ path }) => String(path),
    async run({ method, path, body }, env) {
      return await jiraRawRequest(await env.jira(), {
        method,
        path,
        body,
        signal: env.context.signal,
      });
    },
  }),
];

async function fetchComments(
  connection: JiraConnection,
  issueKey: string,
  env: SdkEnvironment,
) {
  const comments: Array<ReturnType<typeof simplifyComment>> = [];
  let startAt = 0;
  while (comments.length < MAX_COMMENTS) {
    const page = await jiraRequest(connection, {
      parse: jsonObject,
      path: `/issue/${pathSegment(issueKey)}/comment`,
      query: { startAt, maxResults: 100, orderBy: "created" },
      signal: env.context.signal,
    });
    const batch = Array.isArray(page.comments) ? page.comments : [];
    comments.push(...batch.map(simplifyComment));
    startAt += batch.length;
    const total = typeof page.total === "number" ? page.total : startAt;
    if (batch.length === 0 || startAt >= total) break;
  }
  return comments;
}

export function createJiraFieldLoader(
  context: IntegrationExecutionContext,
  connection: () => Promise<JiraConnection>,
): () => Promise<JiraFieldInfo[]> {
  let fields: Promise<JiraFieldInfo[]> | undefined;
  return () =>
    (fields ??= connection().then(async (conn) => {
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
    }));
}

export function jiraConnectionLoader(context: IntegrationExecutionContext) {
  let connection: Promise<JiraConnection> | undefined;
  return () => (connection ??= requireJiraConnection(context));
}

function namesOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const name = (item as { name?: unknown } | null)?.name;
        return typeof name === "string" ? [name] : [];
      })
    : [];
}
