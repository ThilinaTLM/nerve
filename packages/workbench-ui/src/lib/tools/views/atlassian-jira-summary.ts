import type { LiveToolCallDraft } from "../../state/transcript-types";
import {
  type ArgSource,
  type AtlassianSummaryOptions,
  addIncludedCounts,
  addLine,
  addListLine,
  addTextBlock,
  appendArtifactLines,
  appendJiraAssignee,
  appendLimitLines,
  appendList,
  appendMutationOptions,
  appendPayloadSummary,
  appendPreviewHint,
  appendRecordKeys,
  appendResolvedAssignee,
  appendSavePreference,
  asRecord,
  compactLines,
  countLabel,
  draftArgSource,
  enabledFlags,
  formatJiraField,
  formatJiraIssue,
  formatJiraProject,
  formatJiraTransition,
  formatJiraUser,
  jiraBodyText,
  type SummaryBudget,
  sourceBoolean,
  sourceNumber,
  sourceString,
  sourceStringArray,
  stageTitle,
  stringField,
  summaryBudget,
  toolArgSource,
  toolResultDetails,
  yesNo,
} from "./atlassian-summary-common";
import type { ToolCallDisplayRecord } from "./tool-result-parser";
import type { ToolView } from "./tool-view-types";

type JiraView = Extract<ToolView, { kind: "jira" }>;
type JiraAction = JiraView["action"];

const JIRA_ACTION_LABELS: Record<JiraAction, string> = {
  search_users: "search users",
  search_issues: "search issues",
  get_issue: "get issue",
  get_project: "get project",
  create_issue: "create issue",
  update_issue: "update issue",
  add_comment: "add comment",
  transition_issue: "transition issue",
};

const JIRA_INCLUDED_LABELS: Record<string, string> = {
  comments: "comments",
  transitions: "transitions",
  statuses: "statuses",
  components: "components",
  versions: "versions",
  issueTypes: "issue types",
  fields: "fields",
  priorities: "priorities",
  resolutions: "resolutions",
  worklogs: "worklogs",
  changelog: "changelog entries",
  remoteLinks: "remote links",
  attachments: "attachments",
  editmetaFields: "edit fields",
};

export function isJiraToolName(toolName: string | undefined): boolean {
  return Boolean(toolName?.startsWith("jira_"));
}

export function jiraToolSummaryBody(
  toolCall: ToolCallDisplayRecord,
  view: JiraView,
  options: AtlassianSummaryOptions = {},
): string {
  const budget = summaryBudget(options);
  const source = toolArgSource(toolCall);
  const details = toolResultDetails(toolCall);
  const lines = [
    stageTitle(
      "Jira",
      JIRA_ACTION_LABELS[view.action],
      toolCall.status,
      view.dryRun,
    ),
  ];

  appendJiraRequestLines(lines, view.action, source, view, budget);
  appendJiraOutcomeLines(lines, view, details, budget);
  appendArtifactLines(lines, view, budget);
  appendPreviewHint(lines, toolCall, options);

  return compactLines(lines).join("\n");
}

export function jiraDraftSummaryBody(
  draft: LiveToolCallDraft,
  options: AtlassianSummaryOptions = {},
): string | undefined {
  const action = jiraActionFromToolName(draft.toolName);
  if (!action) return undefined;
  const budget = summaryBudget(options);
  const source = draftArgSource(draft);
  const lines = [
    `${draft.done ? "Prepared" : "Preparing"} Jira ${JIRA_ACTION_LABELS[action]}`,
  ];
  appendJiraRequestLines(lines, action, source, undefined, budget);
  if (lines.length === 1) lines.push("Waiting for arguments…");
  return compactLines(lines).join("\n");
}

function appendJiraRequestLines(
  lines: string[],
  action: JiraAction,
  source: ArgSource,
  view: JiraView | undefined,
  budget: SummaryBudget,
): void {
  switch (action) {
    case "search_users": {
      addLine(lines, "Query", view?.query ?? sourceString(source, "query"));
      addLine(
        lines,
        "Project",
        view?.projectKey ?? sourceString(source, "project_key"),
      );
      addLine(
        lines,
        "Issue",
        view?.issueKey ?? sourceString(source, "issue_key"),
      );
      addLine(lines, "Limit", sourceNumber(source, "max_results"));
      addLine(
        lines,
        "Include inactive",
        yesNo(sourceBoolean(source, "include_inactive")),
      );
      appendSavePreference(lines, source);
      break;
    }
    case "search_issues": {
      addTextBlock(
        lines,
        "JQL",
        view?.jql ?? sourceString(source, "jql"),
        budget,
      );
      addListLine(lines, "Fields", sourceStringArray(source, "fields"), budget);
      addListLine(lines, "Expand", sourceStringArray(source, "expand"), budget);
      addLine(lines, "Limit", sourceNumber(source, "max_results"));
      addLine(
        lines,
        "Next page token",
        sourceString(source, "next_page_token"),
      );
      addLine(
        lines,
        "Validate query",
        yesNo(sourceBoolean(source, "validate_query")),
      );
      appendSavePreference(lines, source);
      break;
    }
    case "get_issue": {
      addLine(
        lines,
        "Issue",
        view?.issueKey ?? sourceString(source, "issue_key"),
      );
      addListLine(lines, "Fields", sourceStringArray(source, "fields"), budget);
      addListLine(lines, "Expand", sourceStringArray(source, "expand"), budget);
      addListLine(
        lines,
        "Includes",
        enabledFlags(source, {
          include_comments: "comments",
          include_transitions: "transitions",
          include_editmeta: "edit metadata",
          include_worklogs: "worklogs",
          include_changelog: "changelog",
          include_remote_links: "remote links",
          include_attachments: "attachments",
        }),
        budget,
      );
      appendLimitLines(lines, source, [
        ["Comment limit", "comment_limit"],
        ["Comment start", "comment_start_at"],
        ["Worklog limit", "worklog_limit"],
        ["Changelog limit", "changelog_limit"],
      ]);
      appendSavePreference(lines, source);
      break;
    }
    case "get_project": {
      addLine(
        lines,
        "Project",
        view?.projectKey ??
          sourceString(source, "project_key") ??
          "default project",
      );
      addListLine(
        lines,
        "Includes",
        enabledFlags(source, {
          include_statuses: "statuses",
          include_components: "components",
          include_versions: "versions",
          include_issue_types: "issue types",
          include_create_meta: "create metadata",
          include_fields: "fields",
          include_priorities: "priorities",
          include_resolutions: "resolutions",
        }),
        budget,
      );
      addLine(lines, "Issue type id", sourceString(source, "issue_type_id"));
      addLine(lines, "Issue type", sourceString(source, "issue_type_name"));
      addLine(lines, "Field query", sourceString(source, "field_query"));
      addLine(lines, "Field limit", sourceNumber(source, "field_limit"));
      appendSavePreference(lines, source);
      break;
    }
    case "create_issue": {
      addLine(
        lines,
        "Project",
        view?.projectKey ??
          sourceString(source, "project_key") ??
          "default project",
      );
      addLine(
        lines,
        "Type",
        view?.issueType ?? sourceString(source, "issue_type"),
      );
      addTextBlock(
        lines,
        "Summary",
        view?.summary ?? sourceString(source, "summary"),
        budget,
      );
      addLine(lines, "Parent", sourceString(source, "parent_key"));
      addTextBlock(
        lines,
        "Description",
        jiraBodyText(source, "description", "description_adf"),
        budget,
      );
      addListLine(lines, "Labels", sourceStringArray(source, "labels"), budget);
      addListLine(
        lines,
        "Components",
        sourceStringArray(source, "components"),
        budget,
      );
      addLine(lines, "Priority", sourceString(source, "priority"));
      appendJiraAssignee(lines, source, view);
      appendRecordKeys(lines, "Custom fields", source.args.fields, budget);
      appendMutationOptions(lines, source, "create issue", view?.dryRun);
      addLine(
        lines,
        "Return issue",
        yesNo(sourceBoolean(source, "return_issue")),
      );
      break;
    }
    case "update_issue": {
      addLine(
        lines,
        "Issue",
        view?.issueKey ?? sourceString(source, "issue_key"),
      );
      addTextBlock(
        lines,
        "New summary",
        sourceString(source, "summary"),
        budget,
      );
      addTextBlock(
        lines,
        "Description",
        jiraBodyText(source, "description", "description_adf"),
        budget,
      );
      addListLine(lines, "Labels", sourceStringArray(source, "labels"), budget);
      addLine(lines, "Priority", sourceString(source, "priority"));
      appendJiraAssignee(lines, source, view);
      appendRecordKeys(lines, "Field keys", source.args.fields, budget);
      appendRecordKeys(lines, "Update ops", source.args.update, budget);
      addLine(
        lines,
        "Notify users",
        yesNo(sourceBoolean(source, "notify_users")),
      );
      appendMutationOptions(lines, source, "update issue", view?.dryRun);
      addLine(
        lines,
        "Return issue",
        yesNo(sourceBoolean(source, "return_issue")),
      );
      break;
    }
    case "add_comment": {
      addLine(
        lines,
        "Issue",
        view?.issueKey ?? sourceString(source, "issue_key"),
      );
      addTextBlock(
        lines,
        "Comment",
        jiraBodyText(source, "body", "body_adf"),
        budget,
      );
      const visibility = asRecord(source.args.visibility);
      if (Object.keys(visibility).length > 0) {
        addLine(
          lines,
          "Visibility",
          [stringField(visibility.type), stringField(visibility.value)]
            .filter(Boolean)
            .join(" · "),
        );
      }
      addLine(
        lines,
        "Return comment",
        yesNo(sourceBoolean(source, "return_comment")),
      );
      if (source.status !== "completed")
        addLine(lines, "Mode", "will add comment");
      break;
    }
    case "transition_issue": {
      addLine(
        lines,
        "Issue",
        view?.issueKey ?? sourceString(source, "issue_key"),
      );
      const transitionTarget = sourceString(source, "transition");
      addLine(
        lines,
        "Transition",
        transitionTarget ??
          (view?.transition ? undefined : "list available transitions"),
      );
      addLine(lines, "Resolution", sourceString(source, "resolution"));
      addTextBlock(
        lines,
        "Comment",
        jiraBodyText(source, "comment", "comment_adf"),
        budget,
      );
      appendRecordKeys(lines, "Field keys", source.args.fields, budget);
      appendRecordKeys(lines, "Update ops", source.args.update, budget);
      if (transitionTarget)
        appendMutationOptions(lines, source, "transition issue", view?.dryRun);
      break;
    }
  }
}

function appendJiraOutcomeLines(
  lines: string[],
  view: JiraView,
  details: Record<string, unknown>,
  budget: SummaryBudget,
): void {
  if (!hasJiraOutcome(view)) return;

  switch (view.action) {
    case "search_users": {
      addLine(
        lines,
        "Returned",
        countLabel(view.userCount ?? view.users.length, "user"),
      );
      appendList(lines, "Users", view.users.map(formatJiraUser), budget);
      break;
    }
    case "search_issues": {
      const returned = countLabel(
        view.issueCount ?? view.issues.length,
        "issue",
      );
      addLine(
        lines,
        "Returned",
        view.total !== undefined && returned
          ? `${returned} (${view.total} total)`
          : returned,
      );
      addLine(lines, "Next page token", view.nextPageToken);
      appendList(lines, "Issues", view.issues.map(formatJiraIssue), budget);
      break;
    }
    case "get_issue": {
      if (view.issue) addLine(lines, "Fetched", formatJiraIssue(view.issue));
      addIncludedCounts(
        lines,
        view.includedCounts,
        JIRA_INCLUDED_LABELS,
        "Included",
      );
      appendList(
        lines,
        "Transitions",
        view.transitions.map(formatJiraTransition),
        budget,
      );
      break;
    }
    case "get_project": {
      if (view.project)
        addLine(lines, "Project", formatJiraProject(view.project));
      addIncludedCounts(
        lines,
        view.includedCounts,
        JIRA_INCLUDED_LABELS,
        "Included",
      );
      appendList(lines, "Fields", view.fields.map(formatJiraField), budget);
      break;
    }
    case "create_issue": {
      addLine(
        lines,
        view.dryRun ? "Would create" : "Created",
        view.issueKey ?? stringField(details.id),
      );
      addLine(lines, "Jira id", stringField(details.id));
      if (view.issue)
        addLine(lines, "Returned issue", formatJiraIssue(view.issue));
      appendResolvedAssignee(lines, view);
      appendPayloadSummary(lines, view.payload ?? details.payload, budget);
      break;
    }
    case "update_issue": {
      addLine(lines, view.dryRun ? "Would update" : "Updated", view.issueKey);
      addLine(
        lines,
        "Updated fields",
        countLabel(
          view.updatedFieldCount ?? view.updatedFields?.length,
          "field",
        ),
      );
      addListLine(lines, "Updated field keys", view.updatedFields, budget);
      if (view.issue)
        addLine(lines, "Returned issue", formatJiraIssue(view.issue));
      appendResolvedAssignee(lines, view);
      appendPayloadSummary(lines, view.payload ?? details.payload, budget);
      break;
    }
    case "add_comment": {
      addLine(lines, "Issue", view.issueKey);
      addLine(lines, "Comment id", view.commentId);
      addLine(lines, "Result", view.messageLines[0]);
      break;
    }
    case "transition_issue": {
      if (view.transition) {
        addLine(
          lines,
          view.dryRun ? "Would transition" : "Transitioned",
          view.issueKey,
        );
        addLine(lines, "Transition", formatJiraTransition(view.transition));
        appendPayloadSummary(lines, view.payload ?? details.payload, budget);
      } else {
        addLine(
          lines,
          "Available",
          countLabel(
            view.transitionCount ?? view.transitions.length,
            "transition",
          ),
        );
        appendList(
          lines,
          "Transitions",
          view.transitions.map(formatJiraTransition),
          budget,
        );
      }
      appendList(
        lines,
        "Transition fields",
        view.fields.map(formatJiraField),
        budget,
      );
      break;
    }
  }
}

function jiraActionFromToolName(
  toolName: string | undefined,
): JiraAction | undefined {
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

function hasJiraOutcome(view: JiraView): boolean {
  return Boolean(
    view.messageLines.length > 0 ||
    view.issues.length > 0 ||
    view.users.length > 0 ||
    view.issue ||
    view.project ||
    view.transitions.length > 0 ||
    view.fields.length > 0 ||
    view.commentId ||
    view.updatedFieldCount !== undefined ||
    view.dryRun,
  );
}
