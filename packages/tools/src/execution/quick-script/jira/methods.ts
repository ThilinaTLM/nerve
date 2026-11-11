import {
  isArray,
  isString,
  jsonArray,
  jsonObject,
  objectWithFields,
} from "../../atlassian/http.js";
import type { IntegrationExecutionContext } from "../../execution-context.js";
import {
  type JiraConnection,
  jiraRawRequest,
  jiraRequest,
  pathSegment,
  requireJiraConnection,
} from "../../jira/client.js";
import { rawMethod } from "../../atlassian/raw-request.js";
import { jiraUsersFromResponse, searchJiraUsers } from "../../jira/users.js";
import {
  DEFAULT_GET_FIELDS,
  DEFAULT_SEARCH_FIELDS,
  defaultSelection,
  flattenIssue,
  type JiraFieldInfo,
  resolveFieldSelection,
  simplifyComment,
  userOf,
} from "./issue.js";
import {
  type ProjectInclude,
  PROJECT_INCLUDES,
  projectExtras,
} from "./discovery.js";
import { fieldMetaMap } from "./field-values.js";
import { jiraExtraMethods, rawBinarySaver } from "./extra-methods.js";
import { jiraEditMethods } from "./edit-methods.js";
import { withTidyErrors } from "../tidy-errors.js";
import { jiraSprintMethods } from "./sprints.js";
import { jiraWriteMethods } from "./write-methods.js";
import { orNotAvailable } from "../errors.js";
import { clampInt, nonEmptyString, optionalText } from "../sdk-args.js";
import {
  defineMethod,
  definePositionalMethod,
  type SdkEnvironment,
  type SdkMethod,
} from "../sdk-types.js";

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

/** The closest `jira_get_project` includes, so rules on the direct read apply. */
function directInclude(include: readonly ProjectInclude[]): string[] {
  const names: Partial<Record<ProjectInclude, string>> = {
    fields: "create_meta",
    statuses: "statuses",
    releases: "versions",
  };
  return include.flatMap((item) => names[item] ?? []);
}

const readMethods: SdkMethod[] = [
  defineMethod({
    product: "jira",
    path: "issues.search",
    risk: "network",
    bare: "jql",
    options: ["jql", "fields", "limit"],
    signature:
      "/** JQL needs a field restriction; a bare ORDER BY is rejected. `fields` replaces the default set. limit default 50, max 1000. */ search(options: string | { jql: string; fields?: string[]; limit?: number }): Promise<Issue[]>",
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
    risk: "network",
    bare: "key",
    options: ["key", "fields", "comments", "transitions"],
    signature:
      "/** `comments: true` adds all comments as `comments` (replacing `comment`); `transitions: true` the statuses it can move to, with their required fields. */ get(options: string | { key: string; fields?: string[]; comments?: boolean; transitions?: boolean }): Promise<Issue & { comments?: IssueComment[]; transitions?: IssueTransition[] }>",
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      fields: fieldsOption(options),
      comments: options.comments === true,
      transitions: options.transitions === true,
    }),
    authorize: ({ key }) => ({
      toolName: "jira_get_issue",
      args: { issue_key: key },
      summary: key,
    }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, fields, comments, transitions }, env) {
      const selection = await selectFields(fields, DEFAULT_GET_FIELDS, env);
      const connection = await env.jira();
      const raw = await jiraRequest(connection, {
        parse: jsonObject,
        path: `/issue/${pathSegment(key)}`,
        query: { fields: selection.map((field) => field.id) },
        signal: env.context.signal,
      });
      const issue = flattenIssue(raw, connection.siteUrl, selection);
      if (comments) {
        delete issue.comment;
        issue.comments = await fetchComments(connection, key, env);
      }
      if (transitions) issue.transitions = await fetchTransitions(key, env);
      return issue;
    },
  }),
  defineMethod({
    product: "jira",
    path: "projects.get",
    risk: "network",
    bare: "key",
    options: ["key", "include", "issueType"],
    signature:
      '/** `include` adds, for learning a project\'s conventions: "fields" (create fields per issue type with required/allowed values; `issueType` limits it to one), "statuses" per issue type, "releases" (fix versions), "boards", "sprints" (active/future; "closedSprints" adds the 10 latest closed per board), "epics" (open). */ get(options: string | { key: string; include?: ("fields" | "statuses" | "releases" | "boards" | "sprints" | "closedSprints" | "epics")[]; issueType?: string }): Promise<JiraProject>',
    parse: (options) => {
      const include = options.include ?? [];
      if (
        !Array.isArray(include) ||
        include.some(
          (item) => !(PROJECT_INCLUDES as readonly unknown[]).includes(item),
        )
      ) {
        throw new Error(
          `include must be an array of: ${PROJECT_INCLUDES.join(", ")}.`,
        );
      }
      return {
        key: nonEmptyString(options.key, "key"),
        include: include as ProjectInclude[],
        issueType: optionalText(options.issueType),
      };
    },
    authorize: ({ key, include }) => ({
      toolName: "jira_get_project",
      args: {
        project_key: key,
        ...(include.length > 0 ? { include: directInclude(include) } : {}),
      },
      summary: key,
    }),
    resource: ({ key }) => `project ${key}`,
    async run({ key, include, issueType }, env) {
      const [project, extras] = await Promise.all([
        jiraRequest(await env.jira(), {
          parse: jsonObject,
          path: `/project/${pathSegment(key)}`,
          signal: env.context.signal,
        }),
        projectExtras(env, key, include, issueType),
      ]);
      return {
        key: project.key ?? key,
        name: project.name ?? null,
        lead: userOf(project.lead),
        issueTypes: namesOf(project.issueTypes),
        components: namesOf(project.components),
        versions: namesOf(project.versions),
        ...extras,
      };
    },
  }),
  defineMethod({
    product: "jira",
    path: "users.search",
    risk: "network",
    bare: "query",
    options: ["query"],
    signature:
      "search(options: string | { query: string }): Promise<JiraUser[]>",
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
    risk: "network",
    options: [],
    signature: "/** Names usable in `fields`. */ list(): Promise<JiraField[]>",
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
    run: async (_parsed, env) =>
      (await env.jiraFields()).map(({ id, name, custom, type }) => ({
        id,
        name,
        custom,
        type,
      })),
  }),
  definePositionalMethod({
    product: "jira",
    path: "request",
    risk: "destructive",
    maxArgs: 4,
    signature:
      '/** Path under /rest/api/3/ or /rest/agile/1.0/. Returns JSON or text, or a FileHandle for binary responses. `query` values may be arrays (repeated). */ request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, query?: Record<string, string | number | boolean | (string | number)[]>): Promise<unknown>',
    parse: ([method, path, body, query]) => ({
      method: rawMethod(method),
      path,
      body,
      query,
    }),
    // GET is a read. Anything else cannot be analysed: `jira_manage_comment`
    // (a delete) only supplies the deny rules, and the call always needs the
    // script to be approved at destructive level, whatever allow rules say.
    authorize: ({ method, path }) => ({
      toolName: method === "GET" ? "jira_get_project" : "jira_manage_comment",
      // Placeholder identifiers only satisfy the direct tool's parameter
      // schema; the real target is the method and path in `summary`.
      args:
        method === "GET"
          ? {}
          : { action: "delete", issue_key: "raw-request", comment_id: "-" },
      summary: `${method} ${String(path)}`,
      ...(method === "GET" ? {} : { approvalRequired: true as const }),
    }),
    resource: ({ path }) => String(path),
    async run({ method, path, body, query }, env) {
      return await jiraRawRequest(await env.jira(), {
        method,
        path,
        body,
        query,
        onBinary: method === "GET" ? rawBinarySaver(env, path) : undefined,
        signal: env.context.signal,
      });
    },
  }),
];

export const jiraMethods: SdkMethod[] = [
  ...readMethods,
  ...jiraWriteMethods,
  ...jiraEditMethods,
  ...jiraSprintMethods,
  ...jiraExtraMethods,
].map(withTidyErrors);

async function fetchTransitions(key: string, env: SdkEnvironment) {
  const response = await jiraRequest(await env.jira(), {
    parse: jsonObject,
    path: `/issue/${pathSegment(key)}/transitions`,
    query: { expand: "transitions.fields" },
    signal: env.context.signal,
  });
  return (Array.isArray(response.transitions) ? response.transitions : []).map(
    (raw) => {
      const transition = (raw ?? {}) as Record<string, unknown>;
      const target = (transition.to ?? {}) as Record<string, unknown>;
      return {
        name: String(transition.name ?? ""),
        to: String(target.name ?? ""),
        requiredFields: [...fieldMetaMap(transition.fields).values()]
          .filter((field) => field.required && !field.hasDefault)
          .map((field) => field.name),
      };
    },
  );
}

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
        const text = (value: unknown) =>
          typeof value === "string" ? value : null;
        return {
          id: String(field.id ?? ""),
          name: String(field.name ?? ""),
          custom: field.custom === true,
          type: text(schema.type),
          items: text(schema.items),
          kind: text(schema.custom) ?? text(schema.system),
        };
      });
    }));
}

export function jiraConnectionLoader(context: IntegrationExecutionContext) {
  let connection: Promise<JiraConnection> | undefined;
  return () =>
    (connection ??= orNotAvailable("jira", () =>
      requireJiraConnection(context),
    ));
}

function namesOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const name = (item as { name?: unknown } | null)?.name;
        return typeof name === "string" ? [name] : [];
      })
    : [];
}
