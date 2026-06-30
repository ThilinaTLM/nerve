import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { ToolExecutionError } from "../common/tool-error.js";
import { adfFromEither } from "./adf.js";
import {
  type JiraConnection,
  jiraRequest,
  pathSegment,
  requireJiraConnection,
} from "./client.js";
import {
  buildJiraTextResult,
  issueLine,
  nameOf,
  transitionLine,
  writeJiraArtifact,
} from "./format.js";

const DEFAULT_SEARCH_FIELDS = [
  "summary",
  "status",
  "assignee",
  "issuetype",
  "priority",
  "updated",
];

type JiraIssueResponse = Record<string, unknown> & {
  key?: string;
  id?: string;
};
type JiraSearchResponse = Record<string, unknown> & {
  issues?: unknown[];
  nextPageToken?: string;
  total?: number;
};

type JiraTransitionsResponse = { transitions?: unknown[] } & Record<
  string,
  unknown
>;

export async function executeJiraSearchIssues(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const jql = requiredString(args.jql, "jql");
  const maxResults = boundedNumber(args.max_results, 25, 1, 100);
  const fields = optionalStringArray(args.fields) ?? DEFAULT_SEARCH_FIELDS;
  const expand = optionalStringArray(args.expand);
  const body: Record<string, unknown> = {
    jql,
    maxResults,
    fields,
  };
  const nextPageToken = optionalString(args.next_page_token);
  if (nextPageToken) body.nextPageToken = nextPageToken;
  if (expand && expand.length > 0) body.expand = expand;

  const data = await jiraRequest<JiraSearchResponse>(connection, {
    method: "POST",
    path: "/search/jql",
    body,
    signal: context.signal,
  });
  const artifact = await maybeArtifact(
    context,
    "search-issues",
    data,
    args.save_to_file,
  );
  const issues = Array.isArray(data.issues) ? data.issues : [];
  const lines = [
    `Jira search returned ${issues.length} issue${issues.length === 1 ? "" : "s"}.`,
  ];
  if (typeof data.total === "number") lines[0] += ` Total: ${data.total}.`;
  if (data.nextPageToken) lines.push(`Next page token: ${data.nextPageToken}`);
  if (artifact) lines.push(`Raw JSON saved to: ${artifact.path}`);
  lines.push("", ...issues.map(issueLine));
  return buildJiraTextResult({
    text: lines.join("\n").trimEnd(),
    context,
    artifact,
    details: {
      jql,
      issueCount: issues.length,
      nextPageToken: data.nextPageToken,
    },
  });
}

export async function executeJiraGetIssue(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const issueKey = requiredString(args.issue_key, "issue_key");
  const fields = optionalStringArray(args.fields) ?? DEFAULT_SEARCH_FIELDS;
  const expand = optionalStringArray(args.expand);
  const issue = await jiraRequest<JiraIssueResponse>(connection, {
    path: `/issue/${pathSegment(issueKey)}`,
    query: { fields, expand },
    signal: context.signal,
  });
  const result: Record<string, unknown> = { issue };
  if (args.include_comments === true) {
    result.comments = await jiraRequest(connection, {
      path: `/issue/${pathSegment(issueKey)}/comment`,
      signal: context.signal,
    });
  }
  if (args.include_transitions === true) {
    result.transitions = await getTransitions(connection, issueKey, context);
  }
  const artifact = await maybeArtifact(
    context,
    "get-issue",
    result,
    args.save_to_file,
  );
  const lines = [issueLine(issue)];
  if (result.comments && typeof result.comments === "object") {
    const comments = (result.comments as { comments?: unknown[] }).comments;
    if (Array.isArray(comments)) lines.push(`Comments: ${comments.length}`);
  }
  if (result.transitions && typeof result.transitions === "object") {
    const transitions = (result.transitions as JiraTransitionsResponse)
      .transitions;
    if (Array.isArray(transitions)) {
      lines.push("Available transitions:", ...transitions.map(transitionLine));
    }
  }
  if (artifact) lines.push(`Raw JSON saved to: ${artifact.path}`);
  return buildJiraTextResult({
    text: lines.join("\n"),
    context,
    artifact,
    details: { issueKey },
  });
}

export async function executeJiraGetProject(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const projectKey =
    optionalString(args.project_key) ?? connection.defaultProjectKey;
  if (!projectKey) {
    throw new ToolExecutionError(
      "JIRA_PROJECT_REQUIRED",
      "project_key is required because no default Jira project key is configured.",
    );
  }
  const project = await jiraRequest<Record<string, unknown>>(connection, {
    path: `/project/${pathSegment(projectKey)}`,
    signal: context.signal,
  });
  const result: Record<string, unknown> = { project };
  if (args.include_statuses === true) {
    result.statuses = await jiraRequest(connection, {
      path: `/project/${pathSegment(projectKey)}/statuses`,
      signal: context.signal,
    });
  }
  if (args.include_components === true) {
    result.components = await jiraRequest(connection, {
      path: `/project/${pathSegment(projectKey)}/components`,
      signal: context.signal,
    });
  }
  if (args.include_versions === true) {
    result.versions = await jiraRequest(connection, {
      path: `/project/${pathSegment(projectKey)}/versions`,
      signal: context.signal,
    });
  }
  const artifact = await maybeArtifact(
    context,
    "get-project",
    result,
    args.save_to_file,
  );
  const name = typeof project.name === "string" ? project.name : projectKey;
  const lines = [`Jira project ${projectKey}: ${name}`];
  for (const key of ["statuses", "components", "versions"] as const) {
    const value = result[key];
    if (Array.isArray(value)) lines.push(`${key}: ${value.length}`);
  }
  if (artifact) lines.push(`Raw JSON saved to: ${artifact.path}`);
  return buildJiraTextResult({
    text: lines.join("\n"),
    context,
    artifact,
    details: { projectKey },
  });
}

export async function executeJiraCreateIssue(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const projectKey =
    optionalString(args.project_key) ?? connection.defaultProjectKey;
  if (!projectKey)
    throw new ToolExecutionError(
      "JIRA_PROJECT_REQUIRED",
      "project_key is required because no default Jira project key is configured.",
    );
  const issueType = requiredString(args.issue_type, "issue_type");
  const summary = requiredString(args.summary, "summary");
  const fields: Record<string, unknown> = rawFields(args.fields);
  fields.project = { key: projectKey };
  fields.issuetype = { name: issueType };
  fields.summary = summary;
  const description = adfFromEither({
    text: args.description,
    adf: args.description_adf,
    textName: "description",
    adfName: "description_adf",
  });
  if (description) fields.description = description;
  const parentKey = optionalString(args.parent_key);
  if (parentKey) fields.parent = { key: parentKey };
  applyCommonFields(fields, args);

  const data = await jiraRequest<Record<string, unknown>>(connection, {
    method: "POST",
    path: "/issue",
    body: { fields },
    signal: context.signal,
  });
  const key = typeof data.key === "string" ? data.key : "(unknown)";
  return buildJiraTextResult({
    text: `Created Jira issue ${key}.`,
    context,
    details: { issueKey: data.key, id: data.id, self: data.self },
  });
}

export async function executeJiraUpdateIssue(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const issueKey = requiredString(args.issue_key, "issue_key");
  const fields: Record<string, unknown> = rawFields(args.fields);
  if (typeof args.summary === "string" && args.summary.trim().length > 0)
    fields.summary = args.summary;
  const description = adfFromEither({
    text: args.description,
    adf: args.description_adf,
    textName: "description",
    adfName: "description_adf",
  });
  if (description) fields.description = description;
  applyCommonFields(fields, args);
  if (Object.keys(fields).length === 0) {
    throw new ToolExecutionError(
      "JIRA_EMPTY_UPDATE",
      "jira_update_issue requires at least one field to update.",
    );
  }
  await jiraRequest(connection, {
    method: "PUT",
    path: `/issue/${pathSegment(issueKey)}`,
    body: { fields },
    signal: context.signal,
  });
  return buildJiraTextResult({
    text: `Updated Jira issue ${issueKey}.`,
    context,
    details: { issueKey, updatedFields: Object.keys(fields) },
  });
}

export async function executeJiraAddComment(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const issueKey = requiredString(args.issue_key, "issue_key");
  const body = adfFromEither({
    text: args.body,
    adf: args.body_adf,
    textName: "body",
    adfName: "body_adf",
  });
  if (!body)
    throw new ToolExecutionError(
      "JIRA_COMMENT_REQUIRED",
      "Provide body or body_adf.",
    );
  const data = await jiraRequest<Record<string, unknown>>(connection, {
    method: "POST",
    path: `/issue/${pathSegment(issueKey)}/comment`,
    body: { body },
    signal: context.signal,
  });
  return buildJiraTextResult({
    text: `Added comment to Jira issue ${issueKey}.`,
    context,
    details: { issueKey, commentId: data.id },
  });
}

export async function executeJiraTransitionIssue(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const issueKey = requiredString(args.issue_key, "issue_key");
  const transitionsResponse = await getTransitions(
    connection,
    issueKey,
    context,
  );
  const transitions = Array.isArray(transitionsResponse.transitions)
    ? transitionsResponse.transitions
    : [];
  const transitionArg = optionalString(args.transition);
  if (args.dry_run === true || !transitionArg) {
    return buildJiraTextResult({
      text: [
        `Available transitions for ${issueKey}:`,
        ...transitions.map(transitionLine),
      ].join("\n"),
      context,
      details: { issueKey, transitions },
    });
  }
  const transition = matchTransition(transitions, transitionArg);
  if (!transition) {
    throw new ToolExecutionError(
      "JIRA_TRANSITION_NOT_FOUND",
      `No Jira transition matched "${transitionArg}" for ${issueKey}.`,
      { availableTransitions: transitions.map(transitionSummary) },
    );
  }
  const transitionRecord = transition as Record<string, unknown>;
  const fields: Record<string, unknown> = rawFields(args.fields);
  const resolution = optionalString(args.resolution);
  if (resolution) fields.resolution = { name: resolution };
  const body: Record<string, unknown> = {
    transition: { id: String(transitionRecord.id) },
  };
  if (Object.keys(fields).length > 0) body.fields = fields;
  const comment = optionalString(args.comment);
  if (comment)
    body.update = {
      comment: [
        {
          add: {
            body: adfFromEither({
              text: comment,
              adf: undefined,
              textName: "comment",
              adfName: "comment_adf",
            }),
          },
        },
      ],
    };
  await jiraRequest(connection, {
    method: "POST",
    path: `/issue/${pathSegment(issueKey)}/transitions`,
    body,
    signal: context.signal,
  });
  return buildJiraTextResult({
    text: `Transitioned Jira issue ${issueKey} via ${transitionLine(transition)}.`,
    context,
    details: { issueKey, transition: transitionSummary(transition) },
  });
}

async function getTransitions(
  connection: JiraConnection,
  issueKey: string,
  context: ToolExecutionContext,
): Promise<JiraTransitionsResponse> {
  return jiraRequest<JiraTransitionsResponse>(connection, {
    path: `/issue/${pathSegment(issueKey)}/transitions`,
    query: { expand: "transitions.fields" },
    signal: context.signal,
  });
}

async function maybeArtifact(
  context: ToolExecutionContext,
  kind: string,
  payload: unknown,
  saveToFile: unknown,
): Promise<
  { path: string; bytes: number; chars: number; lines: number } | undefined
> {
  if (saveToFile === false) return undefined;
  return writeJiraArtifact(context, kind, payload);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Expected an array of strings.");
  return value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    )
    .map((item) => item.trim());
}

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function rawFields(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("fields must be an object.");
  }
  return { ...(value as Record<string, unknown>) };
}

function applyCommonFields(
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

function matchTransition(
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

function transitionSummary(transition: unknown): Record<string, unknown> {
  if (!transition || typeof transition !== "object")
    return { value: transition };
  const record = transition as Record<string, unknown>;
  return {
    id: record.id,
    name: record.name,
    to: nameOf(record.to),
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
