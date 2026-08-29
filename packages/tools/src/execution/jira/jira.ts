import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import {
  boundedNumber,
  enumSet,
  optionalBoolean,
  optionalString,
  optionalStringArray,
  requiredString,
} from "../atlassian/arguments.js";
import { ToolExecutionError } from "../errors/tool-error.js";
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
  writeJiraArtifact,
  summarizeJiraAttachment,
  summarizeJiraChangelog,
  summarizeJiraComment,
  summarizeJiraIssue,
  summarizeJiraIssueLink,
  summarizeJiraRemoteLink,
  summarizeJiraTransition,
  summarizeJiraWorklog,
  takeDisplayItems,
  transitionLine,
} from "./format.js";
import {
  applyCommonFields,
  matchTransition,
  maybeResolveAssignee,
  rawFields,
  rawOptionalRecord,
  summarizeTransitionFields,
  transitionSummary,
} from "./helpers.js";
import {
  appendRelatedPreview,
  formatJiraCommentPreview,
  summarizeRelated,
} from "./related-previews.js";

export { executeJiraGetProject } from "./project.js";
export { executeJiraSearchBoards } from "./search-boards.js";
export { executeJiraSearchIssues } from "./search-issues.js";
export { executeJiraSearchUsers } from "./users.js";
export {
  executeJiraDownloadAttachment,
  executeJiraGetBoard,
  executeJiraGetSprint,
  executeJiraManageBacklog,
  executeJiraManageComment,
  executeJiraManageIssueLink,
  executeJiraManageSprint,
  executeJiraManageWorklog,
  executeJiraManageAttachment,
} from "./resources.js";

const DEFAULT_SEARCH_FIELDS = [
  "summary",
  "status",
  "assignee",
  "issuetype",
  "priority",
  "created",
  "updated",
  "resolution",
  "resolutiondate",
  "duedate",
];
const DEFAULT_GET_ISSUE_FIELDS = [...DEFAULT_SEARCH_FIELDS, "description"];
type JiraIssueResponse = Record<string, unknown> & {
  key?: string;
  id?: string;
};
type JiraTransitionsResponse = { transitions?: unknown[] } & Record<
  string,
  unknown
>;

export async function executeJiraGetIssue(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const issueKey = requiredString(args.issue_key, "issue_key");
  const include = enumSet(args.include, [
    "comments",
    "transitions",
    "editmeta",
    "worklogs",
    "changelog",
    "remote_links",
    "issue_links",
    "attachments",
  ] as const);
  const relatedLimit = boundedNumber(args.related_limit, 50, 1, 100);
  const fields = optionalStringArray(args.fields) ?? DEFAULT_GET_ISSUE_FIELDS;
  const issueFields =
    include.has("attachments") && !fields.includes("attachment")
      ? [...fields, "attachment"]
      : fields;
  const issue = await jiraRequest<JiraIssueResponse>(connection, {
    path: `/issue/${pathSegment(issueKey)}`,
    query: { fields: issueFields },
    signal: context.signal,
  });
  const result: Record<string, unknown> = { issue };
  if (include.has("comments")) {
    result.comments = await jiraRequest(connection, {
      path: `/issue/${pathSegment(issueKey)}/comment`,
      query: {
        startAt: boundedNumber(args.comment_start_at, 0, 0, 100000),
        maxResults: relatedLimit,
      },
      signal: context.signal,
    });
  }
  if (include.has("transitions")) {
    result.transitions = await getTransitions(connection, issueKey, context);
  }
  if (include.has("editmeta")) {
    result.editmeta = await jiraRequest(connection, {
      path: `/issue/${pathSegment(issueKey)}/editmeta`,
      signal: context.signal,
    });
  }
  if (include.has("worklogs")) {
    result.worklogs = await jiraRequest(connection, {
      path: `/issue/${pathSegment(issueKey)}/worklog`,
      query: {
        startAt: boundedNumber(args.worklog_start_at, 0, 0, 100000),
        maxResults: relatedLimit,
      },
      signal: context.signal,
    });
  }
  if (include.has("changelog")) {
    result.changelog = await jiraRequest(connection, {
      path: `/issue/${pathSegment(issueKey)}/changelog`,
      query: {
        startAt: boundedNumber(args.changelog_start_at, 0, 0, 100000),
        maxResults: relatedLimit,
      },
      signal: context.signal,
    });
  }
  if (include.has("remote_links")) {
    result.remoteLinks = await jiraRequest(connection, {
      path: `/issue/${pathSegment(issueKey)}/remotelink`,
      signal: context.signal,
    });
  }
  if (include.has("issue_links")) {
    if (issueFields.includes("issuelinks")) {
      result.issueLinks =
        (issue.fields as { issuelinks?: unknown[] } | undefined)?.issuelinks ??
        [];
    } else {
      const linkedIssue = await jiraRequest<JiraIssueResponse>(connection, {
        path: `/issue/${pathSegment(issueKey)}`,
        query: { fields: ["issuelinks"] },
        signal: context.signal,
      });
      result.issueLinks =
        (linkedIssue.fields as { issuelinks?: unknown[] } | undefined)
          ?.issuelinks ?? [];
    }
  }
  const artifact = await writeJiraArtifact(context, "get-issue", result);
  const issueSummary = summarizeJiraIssue(issue);
  const lines = [
    issueSummary ? formatIssueSummaryLine(issueSummary) : issueLine(issue),
  ];
  if (issueSummary?.descriptionPreview) {
    lines.push(`Description: ${issueSummary.descriptionPreview}`);
  }
  const includedCounts: Record<string, number> = {};
  const comments = summarizeRelated(
    (result.comments as { comments?: unknown[] } | undefined)?.comments,
    summarizeJiraComment,
  );
  if (result.comments) {
    includedCounts.comments = comments.total;
    appendRelatedPreview(
      lines,
      "Comments",
      comments.items,
      comments.total,
      artifact?.path,
      formatJiraCommentPreview,
    );
  }
  const attachmentSummaries = summarizeRelated(
    (issue.fields as { attachment?: unknown[] } | undefined)?.attachment,
    summarizeJiraAttachment,
  );
  if (include.has("attachments")) {
    includedCounts.attachments = attachmentSummaries.total;
    appendRelatedPreview(
      lines,
      "Attachments",
      attachmentSummaries.items,
      attachmentSummaries.total,
      artifact?.path,
      (item) =>
        `- ${item.id ?? "unknown id"} · ${item.filename ?? "attachment"}${item.mediaType ? ` · ${item.mediaType}` : ""}${item.bytes !== undefined ? ` · ${item.bytes} bytes` : ""}`,
    );
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
  const worklogs = summarizeRelated(
    (result.worklogs as { worklogs?: unknown[] } | undefined)?.worklogs,
    summarizeJiraWorklog,
  );
  if (result.worklogs) {
    includedCounts.worklogs = worklogs.total;
    appendRelatedPreview(
      lines,
      "Worklogs",
      worklogs.items,
      worklogs.total,
      artifact?.path,
      (item) =>
        `- ${item.id ?? "unknown id"}${item.author ? ` · ${item.author}` : ""}${item.timeSpent ? ` · ${item.timeSpent}` : ""}${item.commentPreview ? ` — ${item.commentPreview}` : ""}`,
    );
  }
  const histories =
    (
      result.changelog as
        | { values?: unknown[]; histories?: unknown[] }
        | undefined
    )?.values ??
    (result.changelog as { histories?: unknown[] } | undefined)?.histories;
  const changelogEntries = summarizeRelated(histories, summarizeJiraChangelog);
  if (result.changelog) {
    includedCounts.changelog = changelogEntries.total;
    appendRelatedPreview(
      lines,
      "Changelog entries",
      changelogEntries.items,
      changelogEntries.total,
      artifact?.path,
      (item) =>
        `- ${item.id ?? item.created ?? "change"}${item.author ? ` · ${item.author}` : ""}${item.changes?.length ? ` — ${item.changes.join("; ")}` : ""}`,
    );
  }
  const remoteLinks = summarizeRelated(
    result.remoteLinks,
    summarizeJiraRemoteLink,
  );
  if (include.has("remote_links")) {
    includedCounts.remoteLinks = remoteLinks.total;
    appendRelatedPreview(
      lines,
      "Remote links",
      remoteLinks.items,
      remoteLinks.total,
      artifact?.path,
      (item) =>
        `- ${item.id ?? "link"}${item.title ? ` · ${item.title}` : ""}${item.url ? ` · ${item.url}` : ""}`,
    );
  }
  const issueLinks = summarizeRelated(
    result.issueLinks,
    summarizeJiraIssueLink,
  );
  if (include.has("issue_links")) {
    includedCounts.issueLinks = issueLinks.total;
    appendRelatedPreview(
      lines,
      "Issue links",
      issueLinks.items,
      issueLinks.total,
      artifact?.path,
      (item) =>
        `- ${item.id ?? "link"}${item.linkType ? ` · ${item.linkType}` : ""}${item.otherIssueKey ? ` · ${item.otherIssueKey}` : ""}`,
    );
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
  const relatedCollections = [
    relatedPage("comments", result.comments, "comments", "comment_start_at"),
    relatedPage("worklogs", result.worklogs, "worklogs", "worklog_start_at"),
    relatedPage("changelog", result.changelog, "values", "changelog_start_at"),
  ].filter((value) => value !== undefined);
  lines.push(`Raw JSON saved to: ${artifact.path}`);
  return buildJiraTextResult({
    text: lines.join("\n"),
    context,
    artifact,
    details: {
      issueKey,
      issue: issueSummary,
      includedCounts,
      comments: comments.items.length > 0 ? comments.items : undefined,
      relatedCollections:
        relatedCollections.length > 0 ? relatedCollections : undefined,
      displayedCommentCount: comments.items.length || undefined,
      attachments:
        attachmentSummaries.items.length > 0
          ? attachmentSummaries.items
          : undefined,
      worklogs: worklogs.items.length > 0 ? worklogs.items : undefined,
      displayedWorklogCount: worklogs.items.length || undefined,
      changelogEntries:
        changelogEntries.items.length > 0 ? changelogEntries.items : undefined,
      displayedChangelogCount: changelogEntries.items.length || undefined,
      remoteLinks: remoteLinks.items.length > 0 ? remoteLinks.items : undefined,
      displayedRemoteLinkCount: remoteLinks.items.length || undefined,
      issueLinks: issueLinks.items.length > 0 ? issueLinks.items : undefined,
      displayedIssueLinkCount: issueLinks.items.length || undefined,
      transitions:
        transitionSummaries.length > 0 ? transitionSummaries : undefined,
      transitionCount,
      displayedTransitionCount,
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
        operation: "create_issue",
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
      operation: "create_issue",
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
      details: {
        operation: "update_issue",
        dryRun: true,
        issueKey,
        payload,
        resolvedAssignee,
      },
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
      operation: "update_issue",
      issueKey,
      updatedFields: displayedFields,
      updatedFieldCount: updatedFields.length,
      issue: summarizeJiraIssue(returnedIssue),
      resolvedAssignee,
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
        operation: "transition_issue",
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
      operation: "transition_issue",
      issueKey,
      transition: transitionSummaryDetails,
      fields: transitionFields,
      fieldCount: transitionFields.length || undefined,
    },
  });
}

function relatedPage(
  id: string,
  value: unknown,
  itemsKey: string,
  parameter: string,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const page = value as Record<string, unknown>;
  const items = Array.isArray(page[itemsKey]) ? page[itemsKey] : [];
  const start = typeof page.startAt === "number" ? page.startAt : 0;
  const total = typeof page.total === "number" ? page.total : items.length;
  const next = start + items.length;
  return {
    id,
    original: total,
    returned: items.length,
    ...(next < total
      ? {
          continuation: {
            parameter,
            value: next,
            direction: "after" as const,
          },
        }
      : {}),
  };
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
