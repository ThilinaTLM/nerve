import {
  isArray,
  isString,
  jsonObject,
  objectWithFields,
} from "../shared/http.js";
import {
  type JiraConnection,
  jiraRawRequest,
  jiraRequest,
  pathSegment,
} from "./client.js";
import type { JiraSession } from "./session.js";
import { rawMethod } from "../shared/raw-request.js";
import { jiraUsersFromResponse, searchJiraUsers } from "./users.js";
import {
  DEFAULT_GET_FIELDS,
  DEFAULT_SEARCH_FIELDS,
  defaultSelection,
  flattenIssue,
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
import { jiraExtraMethods, rawBinaryNaming } from "./extra-methods.js";
import { jiraEditMethods } from "./edit-methods.js";
import { jiraSprintMethods } from "./sprints.js";
import { jiraWriteMethods } from "./write-methods.js";
import { clampInt, nonEmptyString, optionalText } from "../shared/args.js";
import {
  defineMethod,
  definePositionalMethod,
  type PathedMethod,
} from "../shared/define-method.js";
import { jiraIssue, jiraProject, rawRequest } from "../shared/targets.js";

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
  session: JiraSession,
) {
  return requested
    ? resolveFieldSelection(requested, () => session.fields())
    : Promise.resolve(defaultSelection(defaults));
}

const readMethods: PathedMethod<JiraSession>[] = [
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
    authorize: ({ jql }) => ({ targets: [], summary: jql }),
    resource: () => "this Jira search",
    async run({ jql, limit, fields }, session) {
      const selection = await selectFields(
        fields,
        DEFAULT_SEARCH_FIELDS,
        session,
      );
      const connection = session.connection;
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
      "/** `comments: true` adds all comments; `transitions: true` adds reachable statuses with requiredFields. */ get(options: string | { key: string; fields?: string[]; comments?: boolean; transitions?: boolean }): Promise<Issue & { comments?: IssueComment[]; transitions?: IssueTransition[] }>",
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      fields: fieldsOption(options),
      comments: options.comments === true,
      transitions: options.transitions === true,
    }),
    authorize: ({ key }) => ({ targets: [jiraIssue(key)], summary: key }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, fields, comments, transitions }, session) {
      const selection = await selectFields(fields, DEFAULT_GET_FIELDS, session);
      const connection = session.connection;
      const raw = await jiraRequest(connection, {
        parse: jsonObject,
        path: `/issue/${pathSegment(key)}`,
        query: { fields: selection.map((field) => field.id) },
      });
      const issue = flattenIssue(raw, connection.siteUrl, selection);
      if (comments) {
        delete issue.comment;
        issue.comments = await fetchComments(connection, key);
      }
      if (transitions) issue.transitions = await fetchTransitions(key, session);
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
      '/** `include` adds: "fields" (create fields per issue type with required/allowed; `issueType` limits), "statuses", "releases", "boards", "sprints" (active/future; "closedSprints" adds 10 latest per board), "epics" (open). */ get(options: string | { key: string; include?: ("fields" | "statuses" | "releases" | "boards" | "sprints" | "closedSprints" | "epics")[]; issueType?: string }): Promise<JiraProject>',
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
    authorize: ({ key }) => ({ targets: [jiraProject(key)], summary: key }),
    resource: ({ key }) => `project ${key}`,
    async run({ key, include, issueType }, session) {
      const [project, extras] = await Promise.all([
        jiraRequest(session.connection, {
          parse: jsonObject,
          path: `/project/${pathSegment(key)}`,
        }),
        projectExtras(session, key, include, issueType),
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
    authorize: (query) => ({ targets: [], summary: query }),
    resource: () => "Jira users",
    async run(query, session) {
      const response = await searchJiraUsers(session.connection, {
        query,
        maxResults: 50,
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
    signature: "list(): Promise<JiraField[]>",
    parse: () => undefined,
    authorize: () => ({ targets: [], summary: "all fields" }),
    resource: () => "Jira fields",
    run: async (_parsed, session) =>
      (await session.fields()).map(({ id, name, custom, type }) => ({
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
    riskFromArgs: true,
    maxArgs: 4,
    signature:
      '/** Path under /rest/api/3/ or /rest/agile/1.0/. Binary responses return a FileHandle; array query values repeat. */ request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, query?: Record<string, string | number | boolean | (string | number)[]>): Promise<unknown>',
    parse: ([method, path, body, query]) => ({
      method: rawMethod(method),
      path,
      body,
      query,
    }),
    // GET is a network read. Anything else cannot be analysed and counts as
    // destructive; a rule matching the method and path can still allow it.
    authorize: ({ method, path }) => ({
      risk: method === "GET" ? "network" : "destructive",
      targets: [rawRequest("jira", `${method} ${String(path)}`)],
      summary: `${method} ${String(path)}`,
    }),
    resource: ({ path }) => String(path),
    async run({ method, path, body, query }, session) {
      return await jiraRawRequest(session.connection, {
        method,
        path,
        body,
        query,
        binary: method === "GET" ? rawBinaryNaming(path) : undefined,
      });
    },
  }),
];

export const jiraMethods: PathedMethod<JiraSession>[] = [
  ...readMethods,
  ...jiraWriteMethods,
  ...jiraEditMethods,
  ...jiraSprintMethods,
  ...jiraExtraMethods,
];

async function fetchTransitions(key: string, session: JiraSession) {
  const response = await jiraRequest(session.connection, {
    parse: jsonObject,
    path: `/issue/${pathSegment(key)}/transitions`,
    query: { expand: "transitions.fields" },
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

async function fetchComments(connection: JiraConnection, issueKey: string) {
  const comments: Array<ReturnType<typeof simplifyComment>> = [];
  let startAt = 0;
  while (comments.length < MAX_COMMENTS) {
    const page = await jiraRequest(connection, {
      parse: jsonObject,
      path: `/issue/${pathSegment(issueKey)}/comment`,
      query: { startAt, maxResults: 100, orderBy: "created" },
    });
    const batch = Array.isArray(page.comments) ? page.comments : [];
    comments.push(...batch.map(simplifyComment));
    startAt += batch.length;
    const total = typeof page.total === "number" ? page.total : startAt;
    if (batch.length === 0 || startAt >= total) break;
  }
  return comments;
}

function namesOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const name = (item as { name?: unknown } | null)?.name;
        return typeof name === "string" ? [name] : [];
      })
    : [];
}
