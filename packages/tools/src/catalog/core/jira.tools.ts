import { Type } from "typebox";
import {
  executeJiraAddComment,
  executeJiraCreateIssue,
  executeJiraGetIssue,
  executeJiraGetProject,
  executeJiraSearchIssues,
  executeJiraSearchUsers,
  executeJiraTransitionIssue,
  executeJiraUpdateIssue,
} from "../../execution/jira/jira.js";
import type { CoreToolDefinition } from "../types.js";

const jiraGuideline =
  "Use Jira tools for ticket work only when the Jira module is enabled; keep JQL, fields, and result limits narrow, use saved JSON artifact paths for large analyses, and mutate tickets only when the user asked for Jira changes.";

const stringArray = (description: string) =>
  Type.Array(Type.String(), { description });
const unknownRecord = (description: string) =>
  Type.Record(Type.String(), Type.Any(), { description });
const positiveInteger = (description: string, maximum = 100) =>
  Type.Number({ description, minimum: 0, maximum });

const visibilityObject = Type.Object(
  {
    type: Type.String({ description: "Jira comment visibility type" }),
    value: Type.String({ description: "Jira comment visibility value" }),
  },
  { additionalProperties: false },
);

const searchUsersParameters = Type.Object(
  {
    query: Type.String({ description: "User name, email, or account query" }),
    project_key: Type.Optional(
      Type.String({
        description:
          "Project key for assignable user search; defaults from settings",
      }),
    ),
    issue_key: Type.Optional(
      Type.String({ description: "Issue key for assignable user search" }),
    ),
    max_results: Type.Optional(
      Type.Number({
        description: "Maximum users to return (default: 10, max: 50)",
        minimum: 1,
        maximum: 50,
      }),
    ),
    include_inactive: Type.Optional(
      Type.Boolean({
        description: "Include inactive users where Jira supports it",
      }),
    ),
    save_to_file: Type.Optional(
      Type.Boolean({
        description: "Save the raw JSON response (default: true)",
      }),
    ),
  },
  { additionalProperties: false },
);

const searchIssuesParameters = Type.Object(
  {
    jql: Type.String({ description: "JQL query to execute" }),
    fields: Type.Optional(
      stringArray("Issue fields to return. Defaults to a narrow summary set."),
    ),
    max_results: Type.Optional(
      Type.Number({
        description: "Maximum issues to return (default: 25, max: 100)",
        minimum: 1,
        maximum: 100,
      }),
    ),
    next_page_token: Type.Optional(
      Type.String({ description: "Continuation token from a previous search" }),
    ),
    expand: Type.Optional(stringArray("Jira expand values")),
    validate_query: Type.Optional(
      Type.Boolean({ description: "Best-effort JQL validation before search" }),
    ),
    save_to_file: Type.Optional(
      Type.Boolean({
        description: "Whether to save the raw JSON response (default: true)",
      }),
    ),
  },
  { additionalProperties: false },
);

const getIssueParameters = Type.Object(
  {
    issue_key: Type.String({ description: "Jira issue key or ID" }),
    fields: Type.Optional(stringArray("Issue fields to return")),
    expand: Type.Optional(stringArray("Jira expand values")),
    include_comments: Type.Optional(
      Type.Boolean({ description: "Fetch comments for the issue" }),
    ),
    include_transitions: Type.Optional(
      Type.Boolean({ description: "Fetch available workflow transitions" }),
    ),
    include_editmeta: Type.Optional(
      Type.Boolean({ description: "Fetch edit metadata for the issue" }),
    ),
    include_worklogs: Type.Optional(
      Type.Boolean({ description: "Fetch issue worklogs" }),
    ),
    include_changelog: Type.Optional(
      Type.Boolean({ description: "Fetch issue changelog entries" }),
    ),
    include_remote_links: Type.Optional(
      Type.Boolean({ description: "Fetch remote links for the issue" }),
    ),
    include_attachments: Type.Optional(
      Type.Boolean({
        description: "Include attachment metadata from issue fields",
      }),
    ),
    comment_limit: Type.Optional(
      positiveInteger("Maximum comments to fetch", 100),
    ),
    comment_start_at: Type.Optional(
      positiveInteger("Comment pagination start", 100000),
    ),
    worklog_limit: Type.Optional(
      positiveInteger("Maximum worklogs to fetch", 100),
    ),
    worklog_start_at: Type.Optional(
      positiveInteger("Worklog pagination start", 100000),
    ),
    changelog_limit: Type.Optional(
      positiveInteger("Maximum changelog entries to fetch", 100),
    ),
    changelog_start_at: Type.Optional(
      positiveInteger("Changelog pagination start", 100000),
    ),
    save_to_file: Type.Optional(
      Type.Boolean({
        description: "Save the raw JSON response (default: true)",
      }),
    ),
  },
  { additionalProperties: false },
);

const getProjectParameters = Type.Object(
  {
    project_key: Type.Optional(
      Type.String({
        description: "Jira project key or ID; defaults from settings",
      }),
    ),
    include_statuses: Type.Optional(
      Type.Boolean({ description: "Include project status metadata" }),
    ),
    include_components: Type.Optional(
      Type.Boolean({ description: "Include project components" }),
    ),
    include_versions: Type.Optional(
      Type.Boolean({ description: "Include project versions" }),
    ),
    include_issue_types: Type.Optional(
      Type.Boolean({ description: "Include project issue types" }),
    ),
    include_create_meta: Type.Optional(
      Type.Boolean({
        description: "Include create metadata and required fields",
      }),
    ),
    issue_type_id: Type.Optional(
      Type.String({ description: "Issue type id for create metadata" }),
    ),
    issue_type_name: Type.Optional(
      Type.String({ description: "Issue type name for create metadata" }),
    ),
    include_fields: Type.Optional(
      Type.Boolean({ description: "Include Jira field metadata" }),
    ),
    field_query: Type.Optional(
      Type.String({ description: "Filter field metadata by query" }),
    ),
    field_limit: Type.Optional(
      positiveInteger("Maximum fields to return", 100),
    ),
    include_priorities: Type.Optional(
      Type.Boolean({ description: "Include Jira priorities" }),
    ),
    include_resolutions: Type.Optional(
      Type.Boolean({ description: "Include Jira resolutions" }),
    ),
    save_to_file: Type.Optional(
      Type.Boolean({
        description: "Save the raw JSON response (default: true)",
      }),
    ),
  },
  { additionalProperties: false },
);

const createIssueParameters = Type.Object(
  {
    project_key: Type.Optional(
      Type.String({ description: "Jira project key; defaults from settings" }),
    ),
    issue_type: Type.String({
      description: "Issue type name, e.g. Task, Story, Bug, Epic, Sub-task",
    }),
    summary: Type.String({ description: "Issue summary" }),
    description: Type.Optional(
      Type.String({ description: "Plain text/markdown-ish issue description" }),
    ),
    description_adf: Type.Optional(
      unknownRecord("Raw Atlassian Document Format description"),
    ),
    parent_key: Type.Optional(
      Type.String({
        description: "Parent issue key for subtasks or child issues",
      }),
    ),
    labels: Type.Optional(stringArray("Issue labels")),
    priority: Type.Optional(Type.String({ description: "Priority name" })),
    assignee_account_id: Type.Optional(
      Type.String({ description: "Jira accountId to assign" }),
    ),
    assignee_query: Type.Optional(
      Type.String({ description: "Resolve one assignable Jira user by query" }),
    ),
    components: Type.Optional(stringArray("Component names")),
    dry_run: Type.Optional(
      Type.Boolean({
        description: "Return the create payload without mutating",
      }),
    ),
    return_issue: Type.Optional(
      Type.Boolean({ description: "Fetch and summarize the created issue" }),
    ),
    fields: Type.Optional(
      unknownRecord("Additional raw Jira fields to merge into fields"),
    ),
  },
  { additionalProperties: false },
);

const updateIssueParameters = Type.Object(
  {
    issue_key: Type.String({ description: "Jira issue key or ID" }),
    summary: Type.Optional(Type.String({ description: "New summary" })),
    description: Type.Optional(
      Type.String({ description: "Plain text/markdown-ish description" }),
    ),
    description_adf: Type.Optional(
      unknownRecord("Raw Atlassian Document Format description"),
    ),
    assignee_account_id: Type.Optional(
      Type.String({ description: "Jira accountId to assign" }),
    ),
    assignee_query: Type.Optional(
      Type.String({ description: "Resolve one assignable Jira user by query" }),
    ),
    labels: Type.Optional(stringArray("Replacement labels")),
    priority: Type.Optional(Type.String({ description: "Priority name" })),
    fields: Type.Optional(
      unknownRecord("Additional raw Jira fields to merge into fields"),
    ),
    update: Type.Optional(
      unknownRecord(
        "Raw Jira update operations to merge into the update payload",
      ),
    ),
    notify_users: Type.Optional(
      Type.Boolean({ description: "Whether Jira should notify users" }),
    ),
    dry_run: Type.Optional(
      Type.Boolean({
        description: "Return the update payload without mutating",
      }),
    ),
    return_issue: Type.Optional(
      Type.Boolean({
        description: "Fetch and summarize the issue after updating",
      }),
    ),
  },
  { additionalProperties: false },
);

const addCommentParameters = Type.Object(
  {
    issue_key: Type.String({ description: "Jira issue key or ID" }),
    body: Type.Optional(
      Type.String({ description: "Plain text/markdown-ish comment body" }),
    ),
    body_adf: Type.Optional(
      unknownRecord("Raw Atlassian Document Format comment body"),
    ),
    visibility: Type.Optional(visibilityObject),
    return_comment: Type.Optional(
      Type.Boolean({
        description: "Include created comment metadata in the result",
      }),
    ),
  },
  { additionalProperties: false },
);

const transitionIssueParameters = Type.Object(
  {
    issue_key: Type.String({ description: "Jira issue key or ID" }),
    transition: Type.Optional(
      Type.String({
        description:
          "Transition id, transition name, or destination status name",
      }),
    ),
    resolution: Type.Optional(
      Type.String({ description: "Resolution name when required" }),
    ),
    comment: Type.Optional(
      Type.String({
        description: "Optional plain text comment to add during transition",
      }),
    ),
    comment_adf: Type.Optional(
      unknownRecord("Optional ADF comment to add during transition"),
    ),
    fields: Type.Optional(
      unknownRecord("Additional fields for the transition payload"),
    ),
    update: Type.Optional(
      unknownRecord("Additional update operations for the transition payload"),
    ),
    dry_run: Type.Optional(
      Type.Boolean({
        description: "Return available transitions without mutating",
      }),
    ),
  },
  { additionalProperties: false },
);

export const jiraToolDefinitions = [
  {
    name: "jira_search_users",
    group: "jira",
    baseRisk: "network",
    traits: ["read_only_network", "credentialed"],
    executionKind: "local",
    executor: executeJiraSearchUsers,
    label: "Jira Search Users",
    description:
      "Search Jira Cloud users and assignable users to discover accountIds.",
    promptSnippet: "Find Jira users/accountIds before assigning tickets",
    promptGuidelines: [jiraGuideline],
    parameters: searchUsersParameters,
    executionMode: "parallel",
  },
  {
    name: "jira_search_issues",
    group: "jira",
    baseRisk: "network",
    traits: ["read_only_network", "credentialed"],
    executionKind: "local",
    executor: executeJiraSearchIssues,
    label: "Jira Search Issues",
    description:
      "Search Jira Cloud issues with JQL. Saves raw JSON for analysis.",
    promptSnippet: "Search Jira issues with narrow JQL, fields, and limits",
    promptGuidelines: [jiraGuideline],
    parameters: searchIssuesParameters,
    executionMode: "parallel",
  },
  {
    name: "jira_get_issue",
    group: "jira",
    baseRisk: "network",
    traits: ["read_only_network", "credentialed"],
    executionKind: "local",
    executor: executeJiraGetIssue,
    label: "Jira Get Issue",
    description:
      "Fetch one Jira issue, optionally including comments, transitions, edit metadata, worklogs, changelog, remote links, and attachment metadata.",
    promptSnippet: "Fetch a Jira issue by key or ID",
    promptGuidelines: [jiraGuideline],
    parameters: getIssueParameters,
    executionMode: "parallel",
  },
  {
    name: "jira_get_project",
    group: "jira",
    baseRisk: "network",
    traits: ["read_only_network", "credentialed"],
    executionKind: "local",
    executor: executeJiraGetProject,
    label: "Jira Get Project",
    description:
      "Fetch Jira project metadata, optionally including statuses, components, versions, issue types, create metadata, fields, priorities, and resolutions.",
    promptSnippet: "Fetch Jira project metadata",
    promptGuidelines: [jiraGuideline],
    parameters: getProjectParameters,
    executionMode: "parallel",
  },
  {
    name: "jira_create_issue",
    group: "jira",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeJiraCreateIssue,
    label: "Jira Create Issue",
    description:
      "Create a Jira issue using typed common fields plus optional raw fields.",
    promptSnippet: "Create Jira issues only when explicitly requested",
    promptGuidelines: [jiraGuideline],
    parameters: createIssueParameters,
    executionMode: "sequential",
  },
  {
    name: "jira_update_issue",
    group: "jira",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeJiraUpdateIssue,
    label: "Jira Update Issue",
    description: "Update common Jira issue fields plus optional raw fields.",
    promptSnippet: "Update Jira issues only when explicitly requested",
    promptGuidelines: [jiraGuideline],
    parameters: updateIssueParameters,
    executionMode: "sequential",
  },
  {
    name: "jira_add_comment",
    group: "jira",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeJiraAddComment,
    label: "Jira Add Comment",
    description: "Add a Jira issue comment from plain text or raw ADF.",
    promptSnippet: "Add Jira comments only when explicitly requested",
    promptGuidelines: [jiraGuideline],
    parameters: addCommentParameters,
    executionMode: "sequential",
  },
  {
    name: "jira_transition_issue",
    group: "jira",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeJiraTransitionIssue,
    label: "Jira Transition Issue",
    description:
      "Discover or execute Jira workflow transitions with safe matching and dry-run support.",
    promptSnippet: "Transition Jira issues only when explicitly requested",
    promptGuidelines: [jiraGuideline],
    parameters: transitionIssueParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];
