import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { ToolExecutionError } from "../common/tool-error.js";
import { resolveToolPath } from "../filesystem/path.js";
import { adfFromEither } from "./adf.js";
import {
  jiraDownload,
  jiraMultipartRequest,
  jiraRequest,
  pathSegment,
  requireJiraConnection,
} from "./client.js";
import {
  buildJiraTextResult,
  summarizeJiraAttachment,
  summarizeJiraBoard,
  summarizeJiraComment,
  summarizeJiraIssue,
  summarizeJiraIssueLink,
  summarizeJiraSprint,
  summarizeJiraWorklog,
  writeJiraArtifact,
} from "./format.js";
import {
  boundedNumber,
  optionalString,
  optionalStringArray,
  rawOptionalRecord,
  requiredString,
} from "./helpers.js";

const DEFAULT_ISSUE_FIELDS = [
  "summary",
  "status",
  "assignee",
  "issuetype",
  "priority",
  "updated",
];

function dryResult(
  context: ToolExecutionContext,
  text: string,
  details: Record<string, unknown>,
) {
  return buildJiraTextResult({
    text: `Dry run: ${text}`,
    context,
    details: {
      ...details,
      operation: details.operation ?? details.action,
      dryRun: true,
    },
  });
}

async function maybeArtifact(
  context: ToolExecutionContext,
  kind: string,
  data: unknown,
  save: unknown,
) {
  return save === false ? undefined : writeJiraArtifact(context, kind, data);
}

export async function executeJiraGetBoard(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const boardId = requiredString(args.board_id, "board_id");
  const board = await jiraRequest<Record<string, unknown>>(connection, {
    api: "agile",
    path: `/board/${pathSegment(boardId)}`,
    signal: context.signal,
  });
  const result: Record<string, unknown> = { board };
  if (args.include_sprints === true) {
    result.sprints = await jiraRequest(connection, {
      api: "agile",
      path: `/board/${pathSegment(boardId)}/sprint`,
      query: {
        state: optionalStringArray(args.sprint_states),
        startAt: boundedNumber(args.sprint_start_at, 0, 0, 100000),
        maxResults: boundedNumber(args.sprint_limit, 25, 1, 100),
      },
      signal: context.signal,
    });
  }
  if (args.include_backlog === true) {
    result.backlog = await jiraRequest(connection, {
      api: "agile",
      path: `/board/${pathSegment(boardId)}/backlog`,
      query: {
        fields: optionalStringArray(args.fields) ?? DEFAULT_ISSUE_FIELDS,
        startAt: boundedNumber(args.backlog_start_at, 0, 0, 100000),
        maxResults: boundedNumber(args.backlog_limit, 25, 1, 100),
      },
      signal: context.signal,
    });
  }
  const artifact = await maybeArtifact(
    context,
    "get-board",
    result,
    args.save_to_file,
  );
  const sprintCount = Array.isArray(
    (result.sprints as { values?: unknown[] } | undefined)?.values,
  )
    ? (result.sprints as { values: unknown[] }).values.length
    : 0;
  const backlogCount = Array.isArray(
    (result.backlog as { issues?: unknown[] } | undefined)?.issues,
  )
    ? (result.backlog as { issues: unknown[] }).issues.length
    : 0;
  const sprintValues = Array.isArray(
    (result.sprints as { values?: unknown[] } | undefined)?.values,
  )
    ? (result.sprints as { values: unknown[] }).values
    : [];
  const backlogValues = Array.isArray(
    (result.backlog as { issues?: unknown[] } | undefined)?.issues,
  )
    ? (result.backlog as { issues: unknown[] }).issues
    : [];
  return buildJiraTextResult({
    text: `Fetched Jira board ${boardId}.${sprintCount ? ` Sprints: ${sprintCount}.` : ""}${backlogCount ? ` Backlog issues: ${backlogCount}.` : ""}${artifact ? `\nRaw JSON saved to: ${artifact.path}` : ""}`,
    context,
    artifact,
    details: {
      action: "get_board",
      boardId,
      board: summarizeJiraBoard(board),
      sprints: sprintValues
        .flatMap((value) => {
          const summary = summarizeJiraSprint(value);
          return summary ? [summary] : [];
        })
        .slice(0, 20),
      sprintCount,
      backlogIssues: backlogValues
        .flatMap((value) => {
          const summary = summarizeJiraIssue(value);
          return summary ? [summary] : [];
        })
        .slice(0, 20),
      backlogCount,
    },
  });
}

export async function executeJiraGetSprint(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const sprintId = requiredString(args.sprint_id, "sprint_id");
  const sprint = await jiraRequest<Record<string, unknown>>(connection, {
    api: "agile",
    path: `/sprint/${pathSegment(sprintId)}`,
    signal: context.signal,
  });
  const result: Record<string, unknown> = { sprint };
  if (args.include_issues === true) {
    result.issues = await jiraRequest(connection, {
      api: "agile",
      path: `/sprint/${pathSegment(sprintId)}/issue`,
      query: {
        fields: optionalStringArray(args.fields) ?? DEFAULT_ISSUE_FIELDS,
        startAt: boundedNumber(args.start_at, 0, 0, 100000),
        maxResults: boundedNumber(args.limit, 25, 1, 100),
      },
      signal: context.signal,
    });
  }
  const artifact = await maybeArtifact(
    context,
    "get-sprint",
    result,
    args.save_to_file,
  );
  const issueCount = Array.isArray(
    (result.issues as { issues?: unknown[] } | undefined)?.issues,
  )
    ? (result.issues as { issues: unknown[] }).issues.length
    : 0;
  const issueValues = Array.isArray(
    (result.issues as { issues?: unknown[] } | undefined)?.issues,
  )
    ? (result.issues as { issues: unknown[] }).issues
    : [];
  return buildJiraTextResult({
    text: `Fetched Jira sprint ${sprintId}.${args.include_issues === true ? ` Issues: ${issueCount}.` : ""}${artifact ? `\nRaw JSON saved to: ${artifact.path}` : ""}`,
    context,
    artifact,
    details: {
      action: "get_sprint",
      sprintId,
      sprint: summarizeJiraSprint(sprint),
      issues: issueValues
        .flatMap((value) => {
          const summary = summarizeJiraIssue(value);
          return summary ? [summary] : [];
        })
        .slice(0, 20),
      issueCount,
    },
  });
}

export async function executeJiraDownloadAttachment(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const attachmentId = requiredString(args.attachment_id, "attachment_id");
  const metadata = await jiraRequest<Record<string, unknown>>(connection, {
    path: `/attachment/${pathSegment(attachmentId)}`,
    signal: context.signal,
  });
  const downloaded = await jiraDownload(
    connection,
    attachmentId,
    context.signal,
  );
  const requested = optionalString(args.filename);
  const remoteName =
    typeof metadata.filename === "string"
      ? metadata.filename
      : downloaded.filename;
  const filename = safeFilename(
    requested ?? remoteName ?? `attachment-${attachmentId}`,
  );
  const baseDir = context.dataDir
    ? join(context.dataDir, "tmp", "jira", "attachments")
    : join(tmpdir(), "nerve-jira", "attachments");
  await mkdir(baseDir, { recursive: true, mode: 0o700 });
  const hash = createHash("sha256")
    .update(downloaded.bytes)
    .digest("hex")
    .slice(0, 10);
  const path = join(baseDir, `${attachmentId}-${hash}${extname(filename)}`);
  await writeFile(path, downloaded.bytes, { mode: 0o600 });
  return buildJiraTextResult({
    text: `Downloaded Jira attachment ${attachmentId} (${filename}) to ${path}.`,
    context,
    details: {
      action: "download_attachment",
      attachmentId,
      filename,
      mediaType: downloaded.contentType ?? metadata.mimeType,
      bytes: downloaded.bytes.byteLength,
      path,
      outputLimits: {
        artifacts: [
          {
            kind: "raw_result",
            path,
            label: filename,
            bytes: downloaded.bytes.byteLength,
          },
        ],
      },
    },
  });
}

export async function executeJiraManageAttachment(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const action = requiredString(args.action, "action");
  if (action !== "upload" && action !== "delete")
    throw new ToolExecutionError(
      "JIRA_ATTACHMENT_ACTION_INVALID",
      "action must be upload or delete.",
    );
  const connection = await requireJiraConnection(context);
  if (action === "delete") {
    const attachmentId = requiredString(args.attachment_id, "attachment_id");
    if (args.dry_run === true)
      return dryResult(
        context,
        `would delete Jira attachment ${attachmentId}.`,
        {
          action,
          operation: action,
          attachmentId,
        },
      );
    await jiraRequest(connection, {
      method: "DELETE",
      path: `/attachment/${pathSegment(attachmentId)}`,
      signal: context.signal,
    });
    return buildJiraTextResult({
      text: `Deleted Jira attachment ${attachmentId}.`,
      context,
      details: {
        action,
        operation: action,
        attachmentId,
      },
    });
  }

  const issueKey = requiredString(args.issue_key, "issue_key");
  const filePath = resolveToolPath(context.cwd, args.file_path);
  const bytes = await readFile(filePath);
  if (bytes.byteLength > 25 * 1024 * 1024)
    throw new ToolExecutionError(
      "JIRA_ATTACHMENT_TOO_LARGE",
      "Jira attachment exceeds the 25 MiB upload limit.",
    );
  const filename = safeFilename(
    optionalString(args.filename) ?? basename(filePath),
  );
  if (args.dry_run === true)
    return dryResult(context, `would upload ${filename} to ${issueKey}.`, {
      action,
      operation: action,
      issueKey,
      filename,
      bytes: bytes.byteLength,
    });
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), filename);
  const data = await jiraMultipartRequest<unknown[]>(connection, {
    path: `/issue/${pathSegment(issueKey)}/attachments`,
    form,
    signal: context.signal,
  });
  const attachment = Array.isArray(data) ? data[0] : data;
  return buildJiraTextResult({
    text: `Uploaded Jira attachment ${filename} to ${issueKey}.`,
    context,
    details: {
      action,
      operation: action,
      issueKey,
      filename,
      attachment: summarizeJiraAttachment(attachment),
    },
  });
}

export async function executeJiraManageComment(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const action = requiredString(args.action, "action");
  const issueKey = requiredString(args.issue_key, "issue_key");
  const commentId = optionalString(args.comment_id);
  let payload: Record<string, unknown> | undefined;
  if (action !== "delete") {
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
    payload = { body };
    const visibility = rawOptionalRecord(args.visibility, "visibility");
    if (Object.keys(visibility).length) payload.visibility = visibility;
  }
  if (action !== "create" && !commentId)
    throw new ToolExecutionError(
      "JIRA_COMMENT_ID_REQUIRED",
      "comment_id is required.",
    );
  if (args.dry_run === true)
    return dryResult(context, `would ${action} a comment on ${issueKey}.`, {
      action,
      issueKey,
      commentId,
      payload,
    });
  const path = `/issue/${pathSegment(issueKey)}/comment${commentId ? `/${pathSegment(commentId)}` : ""}`;
  const data = await jiraRequest<Record<string, unknown>>(connection, {
    method:
      action === "create" ? "POST" : action === "update" ? "PUT" : "DELETE",
    path,
    body: payload,
    signal: context.signal,
  });
  return buildJiraTextResult({
    text: `${past(action)} Jira comment${commentId ? ` ${commentId}` : ""} on ${issueKey}.`,
    context,
    details: {
      action,
      operation: action,
      issueKey,
      commentId: data?.id ?? commentId,
      commentSummary:
        action === "delete" ? undefined : summarizeJiraComment(data),
    },
  });
}

export async function executeJiraManageWorklog(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const action = requiredString(args.action, "action");
  const issueKey = requiredString(args.issue_key, "issue_key");
  const worklogId = optionalString(args.worklog_id);
  if (action !== "create" && !worklogId)
    throw new ToolExecutionError(
      "JIRA_WORKLOG_ID_REQUIRED",
      "worklog_id is required.",
    );
  const payload: Record<string, unknown> = {};
  if (action !== "delete") {
    const timeSpent = optionalString(args.time_spent);
    const seconds =
      typeof args.time_spent_seconds === "number"
        ? args.time_spent_seconds
        : undefined;
    if (action === "create" && Boolean(timeSpent) === Boolean(seconds))
      throw new ToolExecutionError(
        "JIRA_WORKLOG_TIME_REQUIRED",
        "Provide exactly one of time_spent or time_spent_seconds.",
      );
    if (timeSpent) payload.timeSpent = timeSpent;
    if (seconds !== undefined) payload.timeSpentSeconds = seconds;
    const started = optionalString(args.started);
    if (started) payload.started = started;
    const comment = adfFromEither({
      text: args.comment,
      adf: args.comment_adf,
      textName: "comment",
      adfName: "comment_adf",
    });
    if (comment) payload.comment = comment;
    const visibility = rawOptionalRecord(args.visibility, "visibility");
    if (Object.keys(visibility).length) payload.visibility = visibility;
  }
  if (action === "update" && Object.keys(payload).length === 0) {
    throw new ToolExecutionError(
      "JIRA_EMPTY_WORKLOG_UPDATE",
      "Provide at least one worklog field to update.",
    );
  }
  const query = estimateQuery(args);
  if (args.dry_run === true)
    return dryResult(context, `would ${action} a worklog on ${issueKey}.`, {
      action,
      issueKey,
      worklogId,
      payload,
      query,
    });
  const path = `/issue/${pathSegment(issueKey)}/worklog${worklogId ? `/${pathSegment(worklogId)}` : ""}`;
  const data = await jiraRequest<Record<string, unknown>>(connection, {
    method:
      action === "create" ? "POST" : action === "update" ? "PUT" : "DELETE",
    path,
    query,
    body: action === "delete" ? undefined : payload,
    signal: context.signal,
  });
  return buildJiraTextResult({
    text: `${past(action)} Jira worklog${worklogId ? ` ${worklogId}` : ""} on ${issueKey}.`,
    context,
    details: {
      action,
      operation: action,
      issueKey,
      worklogId: data?.id ?? worklogId,
      worklog: action === "delete" ? undefined : summarizeJiraWorklog(data),
    },
  });
}

export async function executeJiraManageIssueLink(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const action = requiredString(args.action, "action");
  const issueKey = requiredString(args.issue_key, "issue_key");
  const linkId = optionalString(args.link_id);
  if (action === "delete") {
    if (!linkId)
      throw new ToolExecutionError(
        "JIRA_LINK_ID_REQUIRED",
        "link_id is required.",
      );
    if (args.dry_run === true)
      return dryResult(
        context,
        `would delete issue link ${linkId} for ${issueKey}.`,
        { action, issueKey, linkId },
      );
    await jiraRequest(connection, {
      method: "DELETE",
      path: `/issueLink/${pathSegment(linkId)}`,
      signal: context.signal,
    });
    return buildJiraTextResult({
      text: `Deleted Jira issue link ${linkId} for ${issueKey}.`,
      context,
      details: {
        action,
        operation: action,
        issueKey,
        linkId,
        issueLink: summarizeJiraIssueLink({ id: linkId, issueKey }),
      },
    });
  }
  const otherIssueKey = requiredString(args.other_issue_key, "other_issue_key");
  const linkType = requiredString(args.link_type, "link_type");
  const direction = requiredString(args.direction, "direction");
  const types = await jiraRequest<{
    issueLinkTypes?: Array<{ name?: string }>;
  }>(connection, { path: "/issueLinkType", signal: context.signal });
  if (
    !types.issueLinkTypes?.some(
      (type) => type.name?.toLowerCase() === linkType.toLowerCase(),
    )
  )
    throw new ToolExecutionError(
      "JIRA_LINK_TYPE_NOT_FOUND",
      `Jira issue link type '${linkType}' was not found.`,
      { available: types.issueLinkTypes },
    );
  const payload: Record<string, unknown> = {
    type: { name: linkType },
    inwardIssue: { key: direction === "inward" ? issueKey : otherIssueKey },
    outwardIssue: { key: direction === "outward" ? issueKey : otherIssueKey },
  };
  const comment = adfFromEither({
    text: args.comment,
    adf: args.comment_adf,
    textName: "comment",
    adfName: "comment_adf",
  });
  if (comment) payload.comment = { body: comment };
  if (args.dry_run === true)
    return dryResult(context, `would link ${issueKey} and ${otherIssueKey}.`, {
      action,
      issueKey,
      otherIssueKey,
      linkType,
      direction,
      payload,
    });
  await jiraRequest(connection, {
    method: "POST",
    path: "/issueLink",
    body: payload,
    signal: context.signal,
  });
  return buildJiraTextResult({
    text: `Created Jira ${linkType} link between ${issueKey} and ${otherIssueKey}.`,
    context,
    details: {
      action,
      operation: action,
      issueKey,
      otherIssueKey,
      linkType,
      direction,
      issueLink: summarizeJiraIssueLink({
        issueKey,
        otherIssueKey,
        linkType,
        direction,
      }),
    },
  });
}

export async function executeJiraManageSprint(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const action = requiredString(args.action, "action");
  const sprintId = optionalString(args.sprint_id);
  if (action !== "create" && !sprintId)
    throw new ToolExecutionError(
      "JIRA_SPRINT_ID_REQUIRED",
      "sprint_id is required.",
    );
  let current: Record<string, unknown> | undefined;
  if (sprintId)
    current = await jiraRequest<Record<string, unknown>>(connection, {
      api: "agile",
      path: `/sprint/${pathSegment(sprintId)}`,
      signal: context.signal,
    });
  const currentState = optionalString(current?.state);
  if (action === "start" && currentState !== "future") {
    throw new ToolExecutionError(
      "JIRA_SPRINT_INVALID_STATE",
      "Only a future sprint can be started.",
      { sprintId, currentState },
    );
  }
  if (action === "close" && currentState !== "active") {
    throw new ToolExecutionError(
      "JIRA_SPRINT_INVALID_STATE",
      "Only an active sprint can be closed.",
      { sprintId, currentState },
    );
  }
  const payload: Record<string, unknown> = {};
  for (const [arg, key] of [
    ["name", "name"],
    ["goal", "goal"],
    ["start_date", "startDate"],
    ["end_date", "endDate"],
  ] as const) {
    const value = optionalString(args[arg]);
    if (value) payload[key] = value;
  }
  if (action === "update" && Object.keys(payload).length === 0) {
    throw new ToolExecutionError(
      "JIRA_EMPTY_SPRINT_UPDATE",
      "Provide at least one sprint field to update.",
    );
  }
  if (action === "create") {
    payload.name = requiredString(args.name, "name");
    const boardId = Number(requiredString(args.board_id, "board_id"));
    if (!Number.isSafeInteger(boardId) || boardId <= 0) {
      throw new ToolExecutionError(
        "JIRA_BOARD_ID_INVALID",
        "board_id must be a positive numeric Jira board id.",
      );
    }
    payload.originBoardId = boardId;
  }
  if (action === "start") payload.state = "active";
  if (action === "close") payload.state = "closed";
  if (args.dry_run === true)
    return dryResult(
      context,
      `would ${action} Jira sprint ${sprintId ?? "in the selected board"}.`,
      { action, sprintId, current, payload },
    );
  const data = await jiraRequest<Record<string, unknown>>(connection, {
    api: "agile",
    method:
      action === "create" ? "POST" : action === "delete" ? "DELETE" : "PUT",
    path:
      action === "create"
        ? "/sprint"
        : `/sprint/${pathSegment(sprintId ?? "")}`,
    body: action === "delete" ? undefined : payload,
    signal: context.signal,
  });
  return buildJiraTextResult({
    text: `${past(action)} Jira sprint ${data?.id ?? sprintId ?? ""}.`,
    context,
    details: {
      action,
      operation: action,
      sprintId: data?.id ?? sprintId,
      sprint: action === "delete" ? undefined : summarizeJiraSprint(data),
      previousState: currentState,
      resultingState:
        action === "start"
          ? "active"
          : action === "close"
            ? "closed"
            : undefined,
    },
  });
}

export async function executeJiraManageBacklog(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const action = requiredString(args.action, "action");
  const issueKey = requiredString(args.issue_key, "issue_key");
  let path: string;
  let method = "POST";
  let payload: Record<string, unknown>;
  if (action === "move_to_backlog") {
    path = "/backlog/issue";
    payload = { issues: [issueKey] };
  } else if (action === "move_to_sprint") {
    const sprintId = requiredString(args.sprint_id, "sprint_id");
    path = `/sprint/${pathSegment(sprintId)}/issue`;
    payload = { issues: [issueKey] };
  } else {
    path = "/issue/rank";
    method = "PUT";
    const before = optionalString(args.rank_before_issue_key);
    const after = optionalString(args.rank_after_issue_key);
    if (Boolean(before) === Boolean(after))
      throw new ToolExecutionError(
        "JIRA_RANK_ANCHOR_REQUIRED",
        "Provide exactly one rank_before_issue_key or rank_after_issue_key.",
      );
    payload = {
      issues: [issueKey],
      ...(before ? { rankBeforeIssue: before } : { rankAfterIssue: after }),
    };
  }
  if (args.dry_run === true)
    return dryResult(
      context,
      `would ${action.replaceAll("_", " ")} ${issueKey}.`,
      { action, issueKey, payload },
    );
  await jiraRequest(connection, {
    api: "agile",
    method,
    path,
    body: payload,
    signal: context.signal,
  });
  return buildJiraTextResult({
    text: `Updated Jira backlog placement for ${issueKey} (${action.replaceAll("_", " ")}).`,
    context,
    details: {
      action,
      operation: action,
      issueKey,
      sprintId: optionalString(args.sprint_id),
      rankBeforeIssueKey: optionalString(args.rank_before_issue_key),
      rankAfterIssueKey: optionalString(args.rank_after_issue_key),
    },
  });
}

export async function fetchJiraIssueLinkTypes(context: ToolExecutionContext) {
  const connection = await requireJiraConnection(context);
  return jiraRequest(connection, {
    path: "/issueLinkType",
    signal: context.signal,
  });
}

function estimateQuery(
  args: Record<string, unknown>,
): Record<string, string | undefined> {
  return {
    adjustEstimate: optionalString(args.adjust_estimate),
    newEstimate: optionalString(args.new_estimate),
    increaseBy: optionalString(args.increase_by),
  };
}

function safeFilename(value: string): string {
  const name = [...basename(value)]
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
        ? "_"
        : character,
    )
    .join("")
    .trim();
  if (!name || name === "." || name === "..")
    throw new ToolExecutionError(
      "JIRA_INVALID_FILENAME",
      "Attachment filename is invalid.",
    );
  return name.slice(0, 240);
}

function past(action: string): string {
  if (action === "create") return "Created";
  if (action === "update") return "Updated";
  if (action === "delete") return "Deleted";
  if (action === "start") return "Started";
  if (action === "close") return "Closed";
  return `${action}d`;
}
