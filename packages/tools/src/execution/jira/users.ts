import type {
  IntegrationExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import { optionalString, requiredString } from "../atlassian/arguments.js";
import { ToolExecutionError } from "../errors/tool-error.js";
import {
  type JiraConnection,
  jiraRequest,
  requireJiraConnection,
} from "./client.js";
import {
  buildJiraTextResult,
  displayLimitNotice,
  formatUserSummaryLine,
  summarizeJiraUser,
  takeDisplayItems,
  writeJiraArtifact,
} from "./format.js";
import { boundedNumber } from "../atlassian/arguments.js";

export type JiraUsersResponse =
  | unknown[]
  | ({ values?: unknown[] } & Record<string, unknown>);

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
    return jiraRequest<JiraUsersResponse>(connection, {
      path: "/user/assignable/search",
      query: { ...commonQuery, issueKey: options.issueKey },
      signal: options.signal,
    });
  }
  if (options.projectKey) {
    return jiraRequest<JiraUsersResponse>(connection, {
      path: "/user/assignable/search",
      query: { ...commonQuery, project: options.projectKey },
      signal: options.signal,
    });
  }
  return jiraRequest<JiraUsersResponse>(connection, {
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

export async function maybeResolveAssignee(
  connection: JiraConnection,
  args: Record<string, unknown>,
  options: { projectKey?: string; issueKey?: string; signal?: AbortSignal },
): Promise<ReturnType<typeof summarizeJiraUser> | undefined> {
  const query = optionalString(args.assignee_query);
  if (!query) return undefined;
  if (optionalString(args.assignee_account_id)) {
    throw new ToolExecutionError(
      "JIRA_ASSIGNEE_CONFLICT",
      "Provide either assignee_account_id or assignee_query, not both.",
    );
  }
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
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new ToolExecutionError(
      "JIRA_USER_NOT_FOUND",
      `No assignable Jira user matched "${query}".`,
    );
  }
  throw new ToolExecutionError(
    "JIRA_USER_AMBIGUOUS",
    `Multiple assignable Jira users matched "${query}"; use assignee_account_id or a narrower query.`,
    { users: candidates.slice(0, 10) },
  );
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export async function executeJiraSearchUsers(
  args: Record<string, unknown>,
  context: IntegrationExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const query = requiredString(args.query, "query");
  const maxResults = boundedNumber(args.max_results, 10, 1, 50);
  const projectKey =
    optionalString(args.project_key) ?? connection.defaultProjectKey;
  const issueKey = optionalString(args.issue_key);
  const includeInactive = args.include_inactive === true;
  const searchScope = issueKey ? "issue" : projectKey ? "project" : "directory";
  const data = await searchJiraUsers(connection, {
    query,
    projectKey,
    issueKey,
    maxResults,
    includeInactive,
    signal: context.signal,
  });
  const artifact = await writeJiraArtifact(context, "search-users", data);
  const rawUsers = jiraUsersFromResponse(data);
  const users = rawUsers.flatMap((user) => {
    const summary = summarizeJiraUser(user);
    return summary ? [summary] : [];
  });
  const displayed = takeDisplayItems(users);
  const lines = [
    `Jira ${searchScope} user search returned ${rawUsers.length} user${rawUsers.length === 1 ? "" : "s"}.`,
  ];
  const limitNotice = displayLimitNotice({
    noun: "user",
    total: users.length,
    displayed: displayed.displayed,
    artifactPath: artifact?.path,
  });
  if (limitNotice) lines.push(limitNotice);
  if (artifact) lines.push(`Raw JSON saved to: ${artifact.path}`);
  if (displayed.items.length > 0) {
    lines.push("", ...displayed.items.map(formatUserSummaryLine));
  }
  return buildJiraTextResult({
    text: lines.join("\n").trimEnd(),
    context,
    artifact,
    details: {
      query,
      projectKey,
      issueKey,
      searchScope,
      userCount: users.length,
      displayedUserCount: displayed.displayed,
      users: displayed.items,
    },
  });
}
