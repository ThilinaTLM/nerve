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
  displayLimitNotice,
  formatFieldSummaryLine,
  formatIssueSummaryLine,
  formatTransitionSummaryLine,
  issueLine,
  JIRA_FIELD_DISPLAY_LIMIT,
  summarizeJiraAttachment,
  summarizeJiraField,
  summarizeJiraIssue,
  summarizeJiraProject,
  summarizeJiraTransition,
  takeDisplayItems,
  transitionLine,
  writeJiraArtifact,
} from "./format.js";
import {
  applyCommonFields,
  boundedNumber,
  fetchJiraFields,
  fieldsFromProjectResult,
  issueTypeIdFromName,
  matchTransition,
  maybeResolveAssignee,
  optionalBoolean,
  optionalString,
  optionalStringArray,
  rawFields,
  rawOptionalRecord,
  requiredString,
  summarizeTransitionFields,
  transitionSummary,
  validateJql,
  valuesFromJiraList,
} from "./helpers.js";

export { executeJiraSearchUsers } from "./users.js";

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

  let validation: unknown;
  if (args.validate_query === true) {
    validation = await validateJql(connection, jql, context).catch((error) => ({
      warning: error instanceof Error ? error.message : String(error),
    }));
  }
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
  const summarizedIssues = issues.flatMap((issue) => {
    const summary = summarizeJiraIssue(issue);
    return summary ? [summary] : [];
  });
  const displayed = takeDisplayItems(summarizedIssues);
  const total = typeof data.total === "number" ? data.total : undefined;
  const lines = [
    `Jira search returned ${issues.length} issue${issues.length === 1 ? "" : "s"}${total !== undefined ? ` (total ${total})` : ""}.`,
  ];
  if (data.nextPageToken) lines.push(`Next page token: ${data.nextPageToken}`);
  const limitNotice = displayLimitNotice({
    noun: "issue",
    total: summarizedIssues.length,
    displayed: displayed.displayed,
    artifactPath: artifact?.path,
  });
  if (limitNotice) lines.push(limitNotice);
  if (artifact) lines.push(`Raw JSON saved to: ${artifact.path}`);
  if (displayed.items.length > 0) {
    lines.push("", ...displayed.items.map(formatIssueSummaryLine));
  }
  return buildJiraTextResult({
    text: lines.join("\n").trimEnd(),
    context,
    artifact,
    details: {
      jql,
      issueCount: issues.length,
      displayedIssueCount: displayed.displayed,
      total,
      nextPageToken: data.nextPageToken,
      issues: displayed.items,
      validation,
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
  const issueFields =
    args.include_attachments === true && !fields.includes("attachment")
      ? [...fields, "attachment"]
      : fields;
  const expand = optionalStringArray(args.expand);
  const issue = await jiraRequest<JiraIssueResponse>(connection, {
    path: `/issue/${pathSegment(issueKey)}`,
    query: { fields: issueFields, expand },
    signal: context.signal,
  });
  const result: Record<string, unknown> = { issue };
  if (args.include_comments === true) {
    result.comments = await jiraRequest(connection, {
      path: `/issue/${pathSegment(issueKey)}/comment`,
      query: {
        startAt: boundedNumber(args.comment_start_at, 0, 0, 100000),
        maxResults: boundedNumber(args.comment_limit, 50, 1, 100),
      },
      signal: context.signal,
    });
  }
  if (args.include_transitions === true) {
    result.transitions = await getTransitions(connection, issueKey, context);
  }
  if (args.include_editmeta === true) {
    result.editmeta = await jiraRequest(connection, {
      path: `/issue/${pathSegment(issueKey)}/editmeta`,
      signal: context.signal,
    });
  }
  if (args.include_worklogs === true) {
    result.worklogs = await jiraRequest(connection, {
      path: `/issue/${pathSegment(issueKey)}/worklog`,
      query: {
        startAt: boundedNumber(args.worklog_start_at, 0, 0, 100000),
        maxResults: boundedNumber(args.worklog_limit, 50, 1, 100),
      },
      signal: context.signal,
    });
  }
  if (args.include_changelog === true) {
    result.changelog = await jiraRequest(connection, {
      path: `/issue/${pathSegment(issueKey)}/changelog`,
      query: {
        startAt: boundedNumber(args.changelog_start_at, 0, 0, 100000),
        maxResults: boundedNumber(args.changelog_limit, 50, 1, 100),
      },
      signal: context.signal,
    });
  }
  if (args.include_remote_links === true) {
    result.remoteLinks = await jiraRequest(connection, {
      path: `/issue/${pathSegment(issueKey)}/remotelink`,
      signal: context.signal,
    });
  }
  const artifact = await maybeArtifact(
    context,
    "get-issue",
    result,
    args.save_to_file,
  );
  const issueSummary = summarizeJiraIssue(issue);
  const lines = [
    issueSummary ? formatIssueSummaryLine(issueSummary) : issueLine(issue),
  ];
  const includedCounts: Record<string, number> = {};
  if (result.comments && typeof result.comments === "object") {
    const comments = (result.comments as { comments?: unknown[] }).comments;
    if (Array.isArray(comments)) {
      includedCounts.comments = comments.length;
      lines.push(`Comments: ${comments.length}`);
    }
  }
  const attachments = (issue.fields as { attachment?: unknown[] } | undefined)
    ?.attachment;
  if (Array.isArray(attachments)) {
    const attachmentSummaries = attachments.flatMap((attachment) => {
      const summary = summarizeJiraAttachment(attachment);
      return summary ? [summary] : [];
    });
    includedCounts.attachments = attachmentSummaries.length;
    lines.push(`Attachments: ${attachmentSummaries.length}`);
  }
  if (result.editmeta && typeof result.editmeta === "object") {
    const fieldsRecord = (
      result.editmeta as { fields?: Record<string, unknown> }
    ).fields;
    if (fieldsRecord && typeof fieldsRecord === "object") {
      includedCounts.editmetaFields = Object.keys(fieldsRecord).length;
      lines.push(`Edit fields: ${Object.keys(fieldsRecord).length}`);
    }
  }
  if (result.worklogs && typeof result.worklogs === "object") {
    const worklogs = (result.worklogs as { worklogs?: unknown[] }).worklogs;
    if (Array.isArray(worklogs)) {
      includedCounts.worklogs = worklogs.length;
      lines.push(`Worklogs: ${worklogs.length}`);
    }
  }
  if (result.changelog && typeof result.changelog === "object") {
    const histories =
      (result.changelog as { values?: unknown[]; histories?: unknown[] })
        .values ?? (result.changelog as { histories?: unknown[] }).histories;
    if (Array.isArray(histories)) {
      includedCounts.changelog = histories.length;
      lines.push(`Changelog entries: ${histories.length}`);
    }
  }
  if (Array.isArray(result.remoteLinks)) {
    includedCounts.remoteLinks = result.remoteLinks.length;
    lines.push(`Remote links: ${result.remoteLinks.length}`);
  }
  let transitionSummaries: NonNullable<
    ReturnType<typeof summarizeJiraTransition>
  >[] = [];
  let displayedTransitionCount: number | undefined;
  let transitionCount: number | undefined;
  if (result.transitions && typeof result.transitions === "object") {
    const transitions = (result.transitions as JiraTransitionsResponse)
      .transitions;
    if (Array.isArray(transitions)) {
      transitionSummaries = transitions.flatMap((transition) => {
        const summary = summarizeJiraTransition(transition);
        return summary ? [summary] : [];
      });
      const displayed = takeDisplayItems(transitionSummaries);
      transitionCount = transitionSummaries.length;
      displayedTransitionCount = displayed.displayed;
      includedCounts.transitions = transitionSummaries.length;
      lines.push(
        "Available transitions:",
        ...displayed.items.map(formatTransitionSummaryLine),
      );
      const limitNotice = displayLimitNotice({
        noun: "transition",
        total: transitionSummaries.length,
        displayed: displayed.displayed,
        artifactPath: artifact?.path,
      });
      if (limitNotice) lines.push(limitNotice);
      transitionSummaries = displayed.items;
    }
  }
  if (artifact) lines.push(`Raw JSON saved to: ${artifact.path}`);
  return buildJiraTextResult({
    text: lines.join("\n"),
    context,
    artifact,
    details: {
      issueKey,
      issue: issueSummary,
      includedCounts,
      transitions:
        transitionSummaries.length > 0 ? transitionSummaries : undefined,
      transitionCount,
      displayedTransitionCount,
    },
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
  if (args.include_issue_types === true || args.include_create_meta === true) {
    result.issueTypes = Array.isArray(project.issueTypes)
      ? project.issueTypes
      : await jiraRequest(connection, {
          path: `/issue/createmeta/${pathSegment(projectKey)}/issuetypes`,
          signal: context.signal,
        }).catch(() => undefined);
  }
  if (args.include_create_meta === true) {
    const issueTypeId =
      optionalString(args.issue_type_id) ??
      issueTypeIdFromName(
        result.issueTypes,
        optionalString(args.issue_type_name),
      );
    result.createMeta = issueTypeId
      ? await jiraRequest(connection, {
          path: `/issue/createmeta/${pathSegment(projectKey)}/issuetypes/${pathSegment(issueTypeId)}`,
          signal: context.signal,
        })
      : result.issueTypes;
  }
  if (args.include_fields === true) {
    result.fields = await fetchJiraFields(connection, {
      query: optionalString(args.field_query),
      maxResults: boundedNumber(args.field_limit, 50, 1, 100),
      signal: context.signal,
    });
  }
  if (args.include_priorities === true) {
    result.priorities = await jiraRequest(connection, {
      path: "/priority",
      signal: context.signal,
    });
  }
  if (args.include_resolutions === true) {
    result.resolutions = await jiraRequest(connection, {
      path: "/resolution",
      signal: context.signal,
    });
  }
  const artifact = await maybeArtifact(
    context,
    "get-project",
    result,
    args.save_to_file,
  );
  const projectSummary = summarizeJiraProject(project, projectKey);
  const name = projectSummary?.name ?? projectKey;
  const lines = [`Jira project ${projectKey}: ${name}`];
  const includedCounts: Record<string, number> = {};
  for (const key of ["statuses", "components", "versions"] as const) {
    const value = result[key];
    if (Array.isArray(value)) {
      includedCounts[key] = value.length;
      lines.push(`${key}: ${value.length}`);
    }
  }
  const issueTypes = valuesFromJiraList(result.issueTypes);
  if (issueTypes.length > 0) {
    includedCounts.issueTypes = issueTypes.length;
    lines.push(`issueTypes: ${issueTypes.length}`);
  }
  const rawFields = fieldsFromProjectResult(result);
  const fieldSummaries = rawFields.flatMap((field) => {
    const summary = summarizeJiraField(field);
    return summary ? [summary] : [];
  });
  const displayedFields = takeDisplayItems(fieldSummaries);
  if (fieldSummaries.length > 0) {
    includedCounts.fields = fieldSummaries.length;
    lines.push(
      `fields: ${fieldSummaries.length}`,
      ...displayedFields.items.map(formatFieldSummaryLine),
    );
  }
  for (const [key, label] of [
    ["priorities", "priorities"],
    ["resolutions", "resolutions"],
  ] as const) {
    const value = result[key];
    if (Array.isArray(value)) {
      includedCounts[key] = value.length;
      lines.push(`${label}: ${value.length}`);
    }
  }
  if (artifact) lines.push(`Raw JSON saved to: ${artifact.path}`);
  return buildJiraTextResult({
    text: lines.join("\n"),
    context,
    artifact,
    details: {
      projectKey,
      project: projectSummary,
      includedCounts,
      fields: displayedFields.items,
      fieldCount: fieldSummaries.length || undefined,
      displayedFieldCount: displayedFields.displayed || undefined,
    },
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
  const resolvedAssignee = await maybeResolveAssignee(connection, args, {
    projectKey,
    signal: context.signal,
  });
  if (resolvedAssignee)
    fields.assignee = { accountId: resolvedAssignee.accountId };

  const payload = { fields };
  if (args.dry_run === true) {
    return buildJiraTextResult({
      text: `Dry run: Jira issue would be created in ${projectKey}.`,
      context,
      details: {
        dryRun: true,
        projectKey,
        issueType,
        summary,
        payload,
        resolvedAssignee,
      },
    });
  }

  const data = await jiraRequest<Record<string, unknown>>(connection, {
    method: "POST",
    path: "/issue",
    body: payload,
    signal: context.signal,
  });
  const key = typeof data.key === "string" ? data.key : "(unknown)";
  const createdIssue =
    args.return_issue === true && typeof data.key === "string"
      ? await jiraRequest<JiraIssueResponse>(connection, {
          path: `/issue/${pathSegment(data.key)}`,
          query: { fields: DEFAULT_SEARCH_FIELDS },
          signal: context.signal,
        })
      : undefined;
  const issueSummary = summarizeJiraIssue(createdIssue);
  return buildJiraTextResult({
    text: `Created Jira issue ${key}.`,
    context,
    details: {
      issueKey: data.key,
      id: data.id,
      self: data.self,
      projectKey,
      issueType,
      summary,
      issue: issueSummary,
      resolvedAssignee,
    },
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
  const resolvedAssignee = await maybeResolveAssignee(connection, args, {
    issueKey,
    signal: context.signal,
  });
  if (resolvedAssignee)
    fields.assignee = { accountId: resolvedAssignee.accountId };
  const update = rawOptionalRecord(args.update, "update");
  if (Object.keys(fields).length === 0 && Object.keys(update).length === 0) {
    throw new ToolExecutionError(
      "JIRA_EMPTY_UPDATE",
      "jira_update_issue requires at least one field or update operation.",
    );
  }
  const payload: Record<string, unknown> = {};
  if (Object.keys(fields).length > 0) payload.fields = fields;
  if (Object.keys(update).length > 0) payload.update = update;
  if (args.dry_run === true) {
    return buildJiraTextResult({
      text: `Dry run: Jira issue ${issueKey} would be updated.`,
      context,
      details: { dryRun: true, issueKey, payload, resolvedAssignee },
    });
  }
  await jiraRequest(connection, {
    method: "PUT",
    path: `/issue/${pathSegment(issueKey)}`,
    query: { notifyUsers: optionalBoolean(args.notify_users) },
    body: payload,
    signal: context.signal,
  });
  const returnedIssue =
    args.return_issue === true
      ? await jiraRequest<JiraIssueResponse>(connection, {
          path: `/issue/${pathSegment(issueKey)}`,
          query: { fields: DEFAULT_SEARCH_FIELDS },
          signal: context.signal,
        })
      : undefined;
  const updatedFields = [...Object.keys(fields), ...Object.keys(update)];
  const displayedFields = updatedFields.slice(0, JIRA_FIELD_DISPLAY_LIMIT);
  const fieldNotice =
    updatedFields.length > displayedFields.length
      ? ` Showing first ${displayedFields.length} of ${updatedFields.length} updated fields.`
      : "";
  return buildJiraTextResult({
    text: `Updated Jira issue ${issueKey}.${fieldNotice}`,
    context,
    details: {
      issueKey,
      updatedFields: displayedFields,
      updatedFieldCount: updatedFields.length,
      issue: summarizeJiraIssue(returnedIssue),
      resolvedAssignee,
    },
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
  const payload: Record<string, unknown> = { body };
  const visibility = rawOptionalRecord(args.visibility, "visibility");
  if (Object.keys(visibility).length > 0) payload.visibility = visibility;
  const data = await jiraRequest<Record<string, unknown>>(connection, {
    method: "POST",
    path: `/issue/${pathSegment(issueKey)}/comment`,
    body: payload,
    signal: context.signal,
  });
  return buildJiraTextResult({
    text: `Added comment to Jira issue ${issueKey}.`,
    context,
    details: {
      issueKey,
      commentId: data.id,
      comment: args.return_comment === true ? data : undefined,
    },
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
  if (!transitionArg) {
    const transitionSummaries = transitions.flatMap((transition) => {
      const summary = summarizeJiraTransition(transition);
      return summary ? [summary] : [];
    });
    const displayed = takeDisplayItems(transitionSummaries);
    const transitionFields = transitions.flatMap((transition) =>
      summarizeTransitionFields(transition),
    );
    const displayedFields = takeDisplayItems(transitionFields);
    const lines = [
      `Available transitions for ${issueKey}:`,
      ...displayed.items.map(formatTransitionSummaryLine),
    ];
    if (displayedFields.items.length > 0) {
      lines.push(
        "Transition fields:",
        ...displayedFields.items.map(formatFieldSummaryLine),
      );
    }
    const limitNotice = displayLimitNotice({
      noun: "transition",
      total: transitionSummaries.length,
      displayed: displayed.displayed,
    });
    if (limitNotice) lines.push(limitNotice);
    return buildJiraTextResult({
      text: lines.join("\n"),
      context,
      details: {
        issueKey,
        transitions: displayed.items,
        transitionCount: transitionSummaries.length,
        displayedTransitionCount: displayed.displayed,
        fields: displayedFields.items,
        fieldCount: transitionFields.length || undefined,
        displayedFieldCount: displayedFields.displayed || undefined,
      },
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
  const update = rawOptionalRecord(args.update, "update");
  const commentBody = adfFromEither({
    text: args.comment,
    adf: args.comment_adf,
    textName: "comment",
    adfName: "comment_adf",
  });
  if (Object.keys(update).length > 0 || commentBody) {
    body.update = { ...update };
    if (commentBody) {
      (body.update as Record<string, unknown>).comment = [
        {
          add: {
            body: commentBody,
          },
        },
      ];
    }
  }
  const transitionSummaryDetails = summarizeJiraTransition(transition);
  const transitionFields = summarizeTransitionFields(transition);
  if (args.dry_run === true) {
    return buildJiraTextResult({
      text: `Dry run: Jira issue ${issueKey} would transition via ${transitionSummaryDetails ? formatTransitionSummaryLine(transitionSummaryDetails) : transitionLine(transition)}.`,
      context,
      details: {
        dryRun: true,
        issueKey,
        transition: transitionSummaryDetails,
        fields: transitionFields,
        fieldCount: transitionFields.length || undefined,
        payload: body,
      },
    });
  }
  await jiraRequest(connection, {
    method: "POST",
    path: `/issue/${pathSegment(issueKey)}/transitions`,
    body,
    signal: context.signal,
  });
  return buildJiraTextResult({
    text: `Transitioned Jira issue ${issueKey} via ${transitionSummaryDetails ? formatTransitionSummaryLine(transitionSummaryDetails) : transitionLine(transition)}.`,
    context,
    details: {
      issueKey,
      transition: transitionSummaryDetails,
      fields: transitionFields,
      fieldCount: transitionFields.length || undefined,
    },
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
