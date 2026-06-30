import {
  jiraFieldSummarySchema,
  jiraIssueSummarySchema,
  jiraProjectSummarySchema,
  jiraResultDetailsSchema,
  jiraTransitionSummarySchema,
  jiraUserSummarySchema,
} from "@nervekit/shared";
import type { LiveToolOutput } from "$lib/core/types/state-types";
import type { ToolCallDisplayRecord } from "./tool-result-parser";
import {
  asRecord,
  outputArtifactsFromDetails,
  outputLimitsFromDetails,
  parseToolExecutionResult,
  resultOutputText,
  stringField,
} from "./tool-view-helpers";
import type { ToolView } from "./tool-view-types";

const JIRA_DISPLAY_ITEM_LIMIT = 20;
const JIRA_FIELD_DISPLAY_LIMIT = 20;
const JIRA_TEXT_FIELD_MAX_CHARS = 300;

type JiraView = Extract<ToolView, { kind: "jira" }>;
type JiraToolAction = JiraView["action"];

export function parseJiraView(
  toolCall: ToolCallDisplayRecord,
  args: Record<string, unknown>,
  rawResult: unknown,
  liveOutput?: LiveToolOutput,
): ToolView {
  const action = jiraAction(toolCall.toolName);
  if (!action) return { kind: "generic" };
  const result = parseToolExecutionResult(rawResult);
  const outputLimits = outputLimitsFromDetails(result?.details);
  const outputArtifacts = outputArtifactsFromDetails(result?.details);
  const details = jiraDetailsRecord(result?.details);
  const content = resultOutputText(result, rawResult, liveOutput);
  const projectKey =
    stringField(details.projectKey) ?? stringField(args.project_key);
  const issueFromDetails = parseJiraIssueSummary(details.issue);
  const issueLines = parseJiraIssueLines(content).slice(
    0,
    JIRA_DISPLAY_ITEM_LIMIT,
  );
  const issue =
    issueFromDetails ?? (action === "get_issue" ? issueLines[0] : undefined);
  const issuesFromDetails = jiraArray(
    details.issues,
    parseJiraIssueSummary,
  ).slice(0, JIRA_DISPLAY_ITEM_LIMIT);
  const issues = issuesFromDetails.length > 0 ? issuesFromDetails : issueLines;
  const transitionLines = parseJiraTransitionLines(content).slice(
    0,
    JIRA_DISPLAY_ITEM_LIMIT,
  );
  const transitionsFromDetails = jiraArray(
    details.transitions,
    parseJiraTransitionSummary,
  ).slice(0, JIRA_DISPLAY_ITEM_LIMIT);
  const transitions =
    transitionsFromDetails.length > 0
      ? transitionsFromDetails
      : transitionLines;
  const users = jiraArray(details.users, parseJiraUserSummary).slice(
    0,
    JIRA_DISPLAY_ITEM_LIMIT,
  );
  const fields = jiraArray(details.fields, parseJiraFieldSummary).slice(
    0,
    JIRA_FIELD_DISPLAY_LIMIT,
  );
  const includedCounts = jiraIncludedCounts(details.includedCounts, content);
  const updatedFields = arrayField(details.updatedFields)
    .filter((field): field is string => typeof field === "string")
    .slice(0, JIRA_FIELD_DISPLAY_LIMIT);
  return {
    kind: "jira",
    action,
    toolName: toolCall.toolName,
    content,
    contentLineCount: actualTextLineCount(
      content,
      toolCall,
      "lines",
      "head",
      outputLimits,
    ),
    messageLines: jiraMessageLines(content),
    jql: stringField(details.jql) ?? stringField(args.jql),
    issueKey:
      stringField(details.issueKey) ??
      issue?.key ??
      stringField(args.issue_key) ??
      stringField(args.parent_key),
    projectKey,
    issueType: stringField(details.issueType) ?? stringField(args.issue_type),
    summary: compactText(
      stringField(details.summary) ?? stringField(args.summary),
    ),
    issue,
    issues,
    issueCount:
      numberField(details.issueCount) ??
      (issues.length > 0 ? issues.length : undefined),
    displayedIssueCount:
      numberField(details.displayedIssueCount) ??
      (issues.length > 0 ? issues.length : undefined),
    total: numberField(details.total),
    nextPageToken: stringField(details.nextPageToken),
    users,
    userCount:
      numberField(details.userCount) ??
      (users.length > 0 ? users.length : undefined),
    displayedUserCount:
      numberField(details.displayedUserCount) ??
      (users.length > 0 ? users.length : undefined),
    project: parseJiraProjectSummary(details.project, projectKey),
    includedCounts,
    updatedFields,
    updatedFieldCount:
      numberField(details.updatedFieldCount) ??
      (updatedFields.length > 0 ? updatedFields.length : undefined),
    commentId: stringField(details.commentId),
    transition: parseJiraTransitionSummary(details.transition),
    transitions,
    fields,
    fieldCount:
      numberField(details.fieldCount) ??
      (fields.length > 0 ? fields.length : undefined),
    displayedFieldCount:
      numberField(details.displayedFieldCount) ??
      (fields.length > 0 ? fields.length : undefined),
    transitionCount:
      numberField(details.transitionCount) ??
      (transitions.length > 0 ? transitions.length : undefined),
    displayedTransitionCount:
      numberField(details.displayedTransitionCount) ??
      (transitions.length > 0 ? transitions.length : undefined),
    outputLimits,
    outputArtifacts,
  };
}

function jiraAction(toolName: string): JiraToolAction | undefined {
  switch (toolName) {
    case "jira_search_users":
      return "search_users";
    case "jira_search_issues":
      return "search_issues";
    case "jira_get_issue":
      return "get_issue";
    case "jira_get_project":
      return "get_project";
    case "jira_create_issue":
      return "create_issue";
    case "jira_update_issue":
      return "update_issue";
    case "jira_add_comment":
      return "add_comment";
    case "jira_transition_issue":
      return "transition_issue";
    default:
      return undefined;
  }
}

function countLines(text: string | undefined): number {
  if (!text) return 0;
  return text.length === 0 ? 0 : text.split("\n").length;
}

function previewOverflowHidden(
  toolCall: ToolCallDisplayRecord,
  noun: string,
  direction?: "head" | "tail" | "mixed",
): number {
  const overflow =
    "previewOverflow" in toolCall ? toolCall.previewOverflow : undefined;
  if (!overflow || overflow.noun !== noun) return 0;
  if (direction && overflow.direction !== direction) return 0;
  return overflow.hidden;
}

function actualTextLineCount(
  text: string | undefined,
  toolCall: ToolCallDisplayRecord,
  noun: string,
  direction: "head" | "tail" | "mixed",
  outputLimits: ReturnType<typeof outputLimitsFromDetails>,
): number {
  return (
    outputLimits?.model?.displayedLines ??
    countLines(text) + previewOverflowHidden(toolCall, noun, direction)
  );
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function compactText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= JIRA_TEXT_FIELD_MAX_CHARS) return normalized;
  return `${normalized.slice(0, JIRA_TEXT_FIELD_MAX_CHARS - 1)}…`;
}

function jiraNameOf(value: unknown): string | undefined {
  const record = asRecord(value);
  return stringField(record.name);
}

function jiraDisplayNameOf(value: unknown): string | undefined {
  const record = asRecord(value);
  return stringField(record.displayName) ?? jiraNameOf(value);
}

function parseJiraIssueSummary(value: unknown) {
  const parsed = jiraIssueSummarySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const record = asRecord(value);
  const fields = asRecord(record.fields);
  const key = stringField(record.key) ?? stringField(record.id);
  if (!key) return undefined;
  return {
    key,
    id: stringField(record.id),
    summary: compactText(stringField(fields.summary)),
    issueType: compactText(jiraNameOf(fields.issuetype)),
    status: compactText(jiraNameOf(fields.status)),
    assignee: compactText(jiraDisplayNameOf(fields.assignee)),
    priority: compactText(jiraNameOf(fields.priority)),
    updated: compactText(stringField(fields.updated)),
  };
}

function parseJiraProjectSummary(value: unknown, fallbackKey?: string) {
  const parsed = jiraProjectSummarySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const record = asRecord(value);
  const key = stringField(record.key) ?? fallbackKey ?? stringField(record.id);
  if (!key) return fallbackKey ? { key: fallbackKey } : undefined;
  return {
    key,
    id: stringField(record.id),
    name: compactText(stringField(record.name)),
    projectTypeKey: compactText(stringField(record.projectTypeKey)),
    lead: compactText(jiraDisplayNameOf(record.lead)),
  };
}

function parseJiraTransitionSummary(value: unknown) {
  const parsed = jiraTransitionSummarySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const record = asRecord(value);
  const id = stringField(record.id);
  if (!id) return undefined;
  return {
    id,
    name: compactText(stringField(record.name)),
    to: compactText(jiraNameOf(record.to) ?? stringField(record.to)),
  };
}

function parseJiraUserSummary(value: unknown) {
  const parsed = jiraUserSummarySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const record = asRecord(value);
  const accountId = stringField(record.accountId);
  if (!accountId) return undefined;
  return {
    accountId,
    displayName: compactText(jiraDisplayNameOf(record)),
    emailAddress: compactText(stringField(record.emailAddress)),
    active: typeof record.active === "boolean" ? record.active : undefined,
    accountType: compactText(stringField(record.accountType)),
  };
}

function parseJiraFieldSummary(value: unknown) {
  const parsed = jiraFieldSummarySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const record = asRecord(value);
  const id = stringField(record.id) ?? stringField(record.key);
  if (!id) return undefined;
  return {
    id,
    name: compactText(stringField(record.name)),
    key: compactText(stringField(record.key)),
    required:
      typeof record.required === "boolean" ? record.required : undefined,
    type: compactText(stringField(record.type)),
    custom: typeof record.custom === "boolean" ? record.custom : undefined,
  };
}

function jiraDetailsRecord(details: unknown): Record<string, unknown> {
  const parsed = jiraResultDetailsSchema.safeParse(details);
  return parsed.success
    ? (parsed.data as Record<string, unknown>)
    : asRecord(details);
}

function jiraArray<T>(
  value: unknown,
  mapper: (item: unknown) => T | undefined,
): T[] {
  return arrayField(value).flatMap((item) => {
    const parsed = mapper(item);
    return parsed ? [parsed] : [];
  });
}

function jiraIssueKeyLike(value: string | undefined): boolean {
  return Boolean(value && /^[A-Z][A-Z0-9]+-\d+$/.test(value));
}

function parseJiraIssueLines(content: string | undefined) {
  if (!content) return [];
  return content.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) return [];
    const body = trimmed.slice(2);
    const [left, ...summaryParts] = body.split(/\s+—\s+/);
    const parts = left
      .split(" · ")
      .map((part) => part.trim())
      .filter(Boolean);
    const key = parts[0];
    if (!jiraIssueKeyLike(key)) return [];
    let issueType: string | undefined;
    let status: string | undefined;
    let priority: string | undefined;
    let assignee: string | undefined;
    for (const part of parts.slice(1)) {
      if (part.startsWith("assignee: "))
        assignee = part.slice("assignee: ".length);
      else if (part.startsWith("priority: "))
        priority = part.slice("priority: ".length);
      else if (!issueType) issueType = part;
      else if (!status) status = part;
    }
    return [
      {
        key,
        issueType: compactText(issueType),
        status: compactText(status),
        priority: compactText(priority),
        assignee: compactText(assignee),
        summary: compactText(summaryParts.join(" — ")),
      },
    ];
  });
}

function parseJiraTransitionLines(content: string | undefined) {
  if (!content) return [];
  return content.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    const match = /^-\s+([^·]+?)\s+·\s+(.+?)(?:\s+→\s+(.+))?$/.exec(trimmed);
    if (!match) return [];
    const id = match[1]?.trim();
    if (!id || jiraIssueKeyLike(id)) return [];
    return [
      {
        id,
        name: compactText(match[2]?.trim()),
        to: compactText(match[3]?.trim()),
      },
    ];
  });
}

function parseJiraIncludedCounts(
  content: string | undefined,
): Record<string, number> | undefined {
  if (!content) return undefined;
  const counts: Record<string, number> = {};
  for (const line of content.split(/\r?\n/)) {
    const match =
      /^(Comments|statuses|components|versions|issueTypes|fields|priorities|resolutions|Worklogs|Attachments|Remote links|Changelog entries|Edit fields):\s+(\d+)\s*$/i.exec(
        line.trim(),
      );
    if (!match) continue;
    const key = match[1].toLowerCase();
    const normalizedKey = key
      .replace("remote links", "remoteLinks")
      .replace("changelog entries", "changelog")
      .replace("edit fields", "editmetaFields")
      .replace("issuetypes", "issueTypes");
    counts[normalizedKey === "comments" ? "comments" : normalizedKey] = Number(
      match[2],
    );
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}

function jiraMessageLines(content: string | undefined): string[] {
  if (!content) return [];
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (line.startsWith("Raw JSON saved to:")) return false;
      if (line.startsWith("Available transitions")) return false;
      if (line.startsWith("- ")) return false;
      return true;
    })
    .slice(0, JIRA_DISPLAY_ITEM_LIMIT);
}

function jiraIncludedCounts(
  value: unknown,
  content: string | undefined,
): Record<string, number> | undefined {
  const record = asRecord(value);
  const counts: Record<string, number> = {};
  for (const key of [
    "comments",
    "transitions",
    "statuses",
    "components",
    "versions",
    "issueTypes",
    "fields",
    "priorities",
    "resolutions",
    "worklogs",
    "changelog",
    "remoteLinks",
    "attachments",
    "editmetaFields",
  ] as const) {
    const count = numberField(record[key]);
    if (count !== undefined) counts[key] = count;
  }
  return Object.keys(counts).length > 0
    ? counts
    : parseJiraIncludedCounts(content);
}
