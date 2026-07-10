import type { ToolExecutionContext } from "../../types.js";
import { ToolExecutionError } from "../common/tool-error.js";
import { type JiraConnection, jiraRequest } from "./client.js";
import { nameOf, summarizeJiraField, summarizeJiraUser } from "./format.js";

export type JiraUsersResponse =
  | unknown[]
  | ({ values?: unknown[] } & Record<string, unknown>);

export function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Expected an array of strings.");
  return value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    )
    .map((item) => item.trim());
}

export function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function rawFields(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("fields must be an object.");
  }
  return { ...(value as Record<string, unknown>) };
}

export function rawOptionalRecord(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return { ...(value as Record<string, unknown>) };
}

export function applyCommonFields(
  fields: Record<string, unknown>,
  args: Record<string, unknown>,
) {
  const labels = optionalStringArray(args.labels);
  if (labels) fields.labels = labels;
  const priority = optionalString(args.priority);
  if (priority) fields.priority = { name: priority };
  const assignee = optionalString(args.assignee_account_id);
  if (assignee) fields.assignee = { accountId: assignee };
  const components = optionalStringArray(args.components);
  if (components) fields.components = components.map((name) => ({ name }));
}

export function matchTransition(
  transitions: unknown[],
  query: string,
): unknown | undefined {
  const normalized = normalize(query);
  return transitions.find((transition) => {
    if (!transition || typeof transition !== "object") return false;
    const record = transition as Record<string, unknown>;
    const id = String(record.id ?? "");
    const name = typeof record.name === "string" ? record.name : "";
    const to = nameOf(record.to) ?? "";
    return (
      id === query ||
      normalize(name) === normalized ||
      normalize(to) === normalized
    );
  });
}

export function transitionSummary(
  transition: unknown,
): Record<string, unknown> {
  if (!transition || typeof transition !== "object") {
    return { value: transition };
  }
  const record = transition as Record<string, unknown>;
  return {
    id: record.id,
    name: record.name,
    to: nameOf(record.to),
  };
}

export async function validateJql(
  connection: JiraConnection,
  jql: string,
  context: ToolExecutionContext,
): Promise<unknown> {
  return jiraRequest(connection, {
    method: "POST",
    path: "/jql/parse",
    body: { queries: [jql], validation: "strict" },
    signal: context.signal,
  });
}

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
  const commonQuery = {
    query: options.query,
    maxResults: options.maxResults,
  };
  if (options.issueKey) {
    return jiraRequest<JiraUsersResponse>(connection, {
      path: "/user/assignable/search",
      query: {
        ...commonQuery,
        issueKey: options.issueKey,
        actionDescriptorId: 1,
      },
      signal: options.signal,
    });
  }
  if (options.projectKey) {
    return jiraRequest<JiraUsersResponse>(connection, {
      path: "/user/assignable/search",
      query: {
        ...commonQuery,
        project: options.projectKey,
        actionDescriptorId: 1,
      },
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

export async function fetchJiraFields(
  connection: JiraConnection,
  options: { query?: string; maxResults: number; signal?: AbortSignal },
): Promise<unknown> {
  return jiraRequest(connection, {
    path: "/field/search",
    query: { query: options.query, maxResults: options.maxResults },
    signal: options.signal,
  }).catch(() =>
    jiraRequest(connection, {
      path: "/field",
      signal: options.signal,
    }),
  );
}

export function valuesFromJiraList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.values)) return record.values;
  }
  return [];
}

export function fieldsFromProjectResult(
  result: Record<string, unknown>,
): unknown[] {
  const directFields = valuesFromJiraList(result.fields);
  const createMeta = result.createMeta;
  if (!createMeta || typeof createMeta !== "object") return directFields;
  const fields = (createMeta as Record<string, unknown>).fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return directFields;
  }
  return [
    ...directFields,
    ...Object.entries(fields).map(([id, value]) =>
      value && typeof value === "object"
        ? { id, ...(value as Record<string, unknown>) }
        : { id, value },
    ),
  ];
}

export function issueTypeIdFromName(
  issueTypes: unknown,
  issueTypeName: string | undefined,
): string | undefined {
  if (!issueTypeName) return undefined;
  return valuesFromJiraList(issueTypes)
    .map((item) => (item && typeof item === "object" ? item : undefined))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .find(
      (item) => normalize(String(item.name ?? "")) === normalize(issueTypeName),
    )?.id as string | undefined;
}

export function summarizeTransitionFields(transition: unknown) {
  if (!transition || typeof transition !== "object") return [];
  const fields = (transition as Record<string, unknown>).fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return [];
  return Object.entries(fields).flatMap(([id, field]) => {
    const summary = summarizeJiraField(
      field && typeof field === "object"
        ? { id, ...(field as Record<string, unknown>) }
        : { id, value: field },
      id,
    );
    return summary ? [summary] : [];
  });
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
