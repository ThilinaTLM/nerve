import {
  isArray,
  jsonArray,
  objectWithFields,
  oneOf,
  type ResponseParser,
} from "../shared/http.js";
import { type JiraConnection, jiraRequest } from "./client.js";
import { summarizeJiraUser } from "./format.js";

export type JiraUsersResponse =
  | unknown[]
  | ({ values?: unknown[] } & Record<string, unknown>);

const parseUsers: ResponseParser<JiraUsersResponse> = oneOf(
  jsonArray,
  objectWithFields<{ values?: unknown[] }>({ values: isArray }),
);

export async function searchJiraUsers(
  connection: JiraConnection,
  options: {
    query: string;
    projectKey?: string;
    issueKey?: string;
    maxResults: number;
    includeInactive?: boolean;
    signal?: AbortSignal;
  },
): Promise<JiraUsersResponse> {
  const commonQuery = { query: options.query, maxResults: options.maxResults };
  if (options.issueKey) {
    return jiraRequest(connection, {
      parse: parseUsers,
      path: "/user/assignable/search",
      query: { ...commonQuery, issueKey: options.issueKey },
      signal: options.signal,
    });
  }
  if (options.projectKey) {
    return jiraRequest(connection, {
      parse: parseUsers,
      path: "/user/assignable/search",
      query: { ...commonQuery, project: options.projectKey },
      signal: options.signal,
    });
  }
  return jiraRequest(connection, {
    parse: parseUsers,
    path: "/user/search",
    query: {
      ...commonQuery,
      includeInactive: options.includeInactive === true,
    },
    signal: options.signal,
  });
}

export function jiraUsersFromResponse(response: JiraUsersResponse): unknown[] {
  if (Array.isArray(response)) return response;
  return Array.isArray(response.values) ? response.values : [];
}

type JiraUserSummary = NonNullable<ReturnType<typeof summarizeJiraUser>>;

/**
 * Finds the one active assignable user a name, email or account id refers to:
 * `user` when unique (an exact match wins), otherwise the candidates.
 */
export async function findAssignableUser(
  connection: JiraConnection,
  query: string,
  options: { projectKey?: string; issueKey?: string; signal?: AbortSignal },
): Promise<{ user?: JiraUserSummary; candidates: JiraUserSummary[] }> {
  const data = await searchJiraUsers(connection, {
    query,
    projectKey: options.projectKey,
    issueKey: options.issueKey,
    maxResults: 10,
    signal: options.signal,
  });
  const users = jiraUsersFromResponse(data).flatMap((user) => {
    const summary = summarizeJiraUser(user);
    return summary ? [summary] : [];
  });
  const activeUsers = users.filter((user) => user.active !== false);
  const exact = activeUsers.filter(
    (user) =>
      normalize(user.displayName ?? "") === normalize(query) ||
      normalize(user.emailAddress ?? "") === normalize(query) ||
      user.accountId === query,
  );
  const candidates = exact.length > 0 ? exact : activeUsers;
  return {
    user: candidates.length === 1 ? candidates[0] : undefined,
    candidates,
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
