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
  simplifyComment,
  userOf,
} from "./jira-issue.js";
import {
  clampInt,
  identifierArgs,
  nonEmptyString,
  objectArg,
} from "./sdk-args.js";
import {
  defineMethod,
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

const ISSUE_KEY_ALIASES = ["key", "issueKey", "issueIdOrKey", "issueId", "id"];
const PROJECT_KEY_ALIASES = [
  "key",
  "projectKey",
  "projectIdOrKey",
  "project",
  "id",
];

export const jiraMethods: SdkMethod[] = [
  defineMethod({
    product: "jira",
    path: "issues.search",
    signature:
      "issues.search({ jql, fields?, limit? }): Promise<Issue[]>  // limit default 50, max 1000",
    parse: ([first, second]) => {
      const options: Record<string, unknown> =
        typeof first === "string"
          ? { jql: first, ...objectArg(second) }
          : { ...objectArg(first), ...objectArg(second) };
      return {
        jql: nonEmptyString(options.jql, "jql"),
        limit: clampInt(
          options.limit,
          DEFAULT_SEARCH_LIMIT,
          1,
          MAX_SEARCH_LIMIT,
        ),
        fields: fieldsOption(options),
      };
    },
    authorize: ({ jql }) => ({
      toolName: "jira_search_issues",
      args: { jql },
      summary: jql,
    }),
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
    signature:
      "issues.get(key, { fields?, comments? }): Promise<Issue & { comments? }>",
    parse: (args) => {
      const { value, options } = identifierArgs(args, ISSUE_KEY_ALIASES, "key");
      return {
        key: value,
        fields: fieldsOption(options),
        comments: options.comments === true,
      };
    },
    authorize: ({ key }) => ({
      toolName: "jira_get_issue",
      args: { issue_key: key },
      summary: key,
    }),
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
    signature:
      "projects.get(key): Promise<{ key, name, lead, issueTypes, components, versions }>",
    parse: (args) => identifierArgs(args, PROJECT_KEY_ALIASES, "key").value,
    authorize: (key) => ({
      toolName: "jira_get_project",
      args: { project_key: key },
      summary: key,
    }),
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
    signature:
      "users.search(query): Promise<{ accountId, name, email, active }[]>",
    parse: ([first]) =>
      typeof first === "object" && first !== null
        ? nonEmptyString(
            (first as Record<string, unknown>).query ??
              (first as Record<string, unknown>).name ??
              (first as Record<string, unknown>).email,
            "query",
          )
        : nonEmptyString(first, "query"),
    authorize: (query) => ({
      toolName: "jira_search_users",
      args: { query },
      summary: query,
    }),
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
    run: (_parsed, env) => env.jiraFields(),
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
