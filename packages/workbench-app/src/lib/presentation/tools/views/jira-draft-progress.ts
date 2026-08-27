import type { ConversationLiveToolDraftBlockSnapshot } from "@nervekit/contracts";
import type { DraftMetaItem } from "./tool-draft-progress";

type FirstKnownString = (
  draft: ConversationLiveToolDraftBlockSnapshot,
  property: string,
) => string | undefined;

export function jiraDraftPrimaryArg(
  draft: ConversationLiveToolDraftBlockSnapshot,
  firstKnownString: FirstKnownString,
): string | undefined {
  const toolName = draft.toolName;
  if (toolName === "jira_search_users") return firstKnownString(draft, "query");
  if (toolName === "jira_search_issues") return firstKnownString(draft, "jql");
  if (toolName === "jira_get_project") {
    return firstKnownString(draft, "project_key") ?? "default project";
  }
  if (toolName === "jira_search_boards")
    return (
      firstKnownString(draft, "project_key") ?? firstKnownString(draft, "name")
    );
  if (toolName === "jira_get_board") return firstKnownString(draft, "board_id");
  if (toolName === "jira_get_sprint" || toolName === "jira_manage_sprint")
    return (
      firstKnownString(draft, "sprint_id") ?? firstKnownString(draft, "name")
    );
  if (toolName === "jira_download_attachment")
    return firstKnownString(draft, "attachment_id");
  if (toolName === "jira_manage_attachment")
    return (
      firstKnownString(draft, "file_path") ??
      firstKnownString(draft, "attachment_id") ??
      firstKnownString(draft, "issue_key")
    );
  if (toolName === "jira_create_issue") {
    return firstKnownString(draft, "summary");
  }
  if (
    toolName === "jira_get_issue" ||
    toolName === "jira_update_issue" ||
    toolName === "jira_manage_comment" ||
    toolName === "jira_manage_worklog" ||
    toolName === "jira_manage_issue_link" ||
    toolName === "jira_manage_backlog" ||
    toolName === "jira_transition_issue"
  ) {
    return firstKnownString(draft, "issue_key");
  }
  return undefined;
}

export function jiraDraftMeta(
  draft: ConversationLiveToolDraftBlockSnapshot,
  firstKnownString: FirstKnownString,
): DraftMetaItem[] {
  const toolName = draft.toolName;
  const args = asRecord(draft.args);
  const meta: DraftMetaItem[] = [];
  if (toolName === "jira_search_users") {
    const maxResults = numberField(args.max_results);
    if (maxResults !== undefined) meta.push({ text: `max ${maxResults}` });
    const project = firstKnownString(draft, "project_key");
    if (project) meta.push({ text: `project ${project}`, mono: true });
    const issue = firstKnownString(draft, "issue_key");
    if (issue) meta.push({ text: issue, mono: true });
  }
  if (toolName === "jira_search_issues") {
    const maxResults = numberField(args.max_results);
    if (maxResults !== undefined) meta.push({ text: `max ${maxResults}` });
    const fields = arrayFieldLength(args.fields);
    if (fields !== undefined) meta.push({ text: plural(fields, "field") });
  }
  if (toolName === "jira_get_issue") {
    for (const value of stringArray(args.include)) {
      meta.push({ text: value.replaceAll("_", " ") });
    }
  }
  if (toolName === "jira_get_project") {
    const project = firstKnownString(draft, "project_key");
    if (project) meta.push({ text: `project ${project}`, mono: true });
    for (const value of stringArray(args.include)) {
      meta.push({ text: value.replaceAll("_", " ") });
    }
  }
  if (toolName === "jira_create_issue") {
    const project = firstKnownString(draft, "project_key");
    const issueType = firstKnownString(draft, "issue_type");
    if (project) meta.push({ text: `project ${project}`, mono: true });
    if (issueType) meta.push({ text: issueType });
    const labels = arrayFieldLength(args.labels);
    if (labels !== undefined) meta.push({ text: plural(labels, "label") });
    const components = arrayFieldLength(args.components);
    if (components !== undefined) {
      meta.push({ text: plural(components, "component") });
    }
    if (args.assignee_query !== undefined)
      meta.push({ text: "resolve assignee" });
    if (args.dry_run === true) meta.push({ text: "dry run", tone: "info" });
  }
  if (toolName === "jira_update_issue") {
    const labels = arrayFieldLength(args.labels);
    if (labels !== undefined) meta.push({ text: plural(labels, "label") });
    if (args.summary !== undefined) meta.push({ text: "summary" });
    if (args.description !== undefined || args.description_adf !== undefined) {
      meta.push({ text: "description" });
    }
    if (args.update !== undefined) meta.push({ text: "update ops" });
    if (args.assignee_query !== undefined)
      meta.push({ text: "resolve assignee" });
    if (args.dry_run === true) meta.push({ text: "dry run", tone: "info" });
  }
  if (toolName === "jira_manage_comment") {
    meta.push({ text: String(args.action ?? "comment") });
  }
  if (toolName === "jira_manage_attachment" && args.action !== undefined) {
    meta.push({ text: String(args.action) });
  }
  if (toolName?.startsWith("jira_manage_") && args.dry_run === true) {
    meta.push({ text: "dry run", tone: "info" });
  }
  if (toolName === "jira_transition_issue") {
    const transition = firstKnownString(draft, "transition");
    if (transition) meta.push({ text: transition });
    if (args.dry_run === true) meta.push({ text: "dry run", tone: "info" });
  }
  return meta;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function arrayFieldLength(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function plural(count: number, singular: string, suffix = "s"): string {
  return `${count} ${singular}${count === 1 ? "" : suffix}`;
}
