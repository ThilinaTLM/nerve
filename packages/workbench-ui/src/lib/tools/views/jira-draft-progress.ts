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
  if (toolName === "jira_create_issue") {
    return firstKnownString(draft, "summary");
  }
  if (
    toolName === "jira_get_issue" ||
    toolName === "jira_update_issue" ||
    toolName === "jira_add_comment" ||
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
    if (args.validate_query === true)
      meta.push({ text: "validate", tone: "info" });
  }
  if (toolName === "jira_get_issue") {
    if (args.include_comments === true) meta.push({ text: "comments" });
    if (args.include_transitions === true) meta.push({ text: "transitions" });
    if (args.include_editmeta === true) meta.push({ text: "editmeta" });
    if (args.include_worklogs === true) meta.push({ text: "worklogs" });
    if (args.include_changelog === true) meta.push({ text: "changelog" });
    if (args.include_remote_links === true) meta.push({ text: "remote links" });
  }
  if (toolName === "jira_get_project") {
    const project = firstKnownString(draft, "project_key");
    if (project) meta.push({ text: `project ${project}`, mono: true });
    if (args.include_statuses === true) meta.push({ text: "statuses" });
    if (args.include_components === true) meta.push({ text: "components" });
    if (args.include_versions === true) meta.push({ text: "versions" });
    if (args.include_issue_types === true) meta.push({ text: "issue types" });
    if (args.include_create_meta === true) meta.push({ text: "create meta" });
    if (args.include_fields === true) meta.push({ text: "fields" });
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
  if (toolName === "jira_add_comment") {
    meta.push({ text: args.body_adf ? "ADF" : "comment" });
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
