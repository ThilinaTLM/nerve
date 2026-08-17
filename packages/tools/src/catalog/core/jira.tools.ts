import { Type } from "typebox";
import {
  executeJiraCreateIssue,
  executeJiraDownloadAttachment,
  executeJiraGetBoard,
  executeJiraGetIssue,
  executeJiraGetProject,
  executeJiraGetSprint,
  executeJiraManageBacklog,
  executeJiraManageComment,
  executeJiraManageIssueLink,
  executeJiraManageSprint,
  executeJiraManageWorklog,
  executeJiraSearchBoards,
  executeJiraSearchIssues,
  executeJiraSearchUsers,
  executeJiraTransitionIssue,
  executeJiraUpdateIssue,
  executeJiraManageAttachment,
} from "../../execution/jira/jira.js";
import { jiraManageAttachmentParameters } from "./jira-attachment.schema.js";
import type { ToolDefinition } from "../types.js";

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
          "Project key for assignable-user search; omitted scope uses the configured default project when present",
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
        description:
          "Include inactive users for directory search; assignable searches ignore this option",
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
      Type.String({
        description:
          "Opaque Jira next-page token returned by the preceding issue search",
      }),
    ),
    expand: Type.Optional(
      stringArray(
        "Jira enhanced-search expansions such as renderedFields, names, or schema; serialized as one comma-delimited API value",
      ),
    ),
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
    include_issue_links: Type.Optional(
      Type.Boolean({ description: "Fetch issue links for the issue" }),
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
    include_issue_link_types: Type.Optional(
      Type.Boolean({ description: "Include Jira issue link types" }),
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

const commentBodyFields = {
  body: Type.Optional(
    Type.String({
      description: "Required for create/update unless body_adf is set",
    }),
  ),
  body_adf: Type.Optional(
    unknownRecord("ADF alternative to body for create/update"),
  ),
  visibility: Type.Optional(visibilityObject),
  dry_run: Type.Optional(
    Type.Boolean({ description: "Validate without mutating" }),
  ),
};
const manageCommentParameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("create"),
      Type.Literal("update"),
      Type.Literal("delete"),
    ]),
    issue_key: Type.String(),
    comment_id: Type.Optional(
      Type.String({ description: "Required for update and delete" }),
    ),
    ...commentBodyFields,
  },
  { additionalProperties: false },
);

const agilePageFields = {
  start_at: Type.Optional(Type.Number({ minimum: 0, maximum: 100000 })),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  save_to_file: Type.Optional(Type.Boolean()),
};
const searchBoardsParameters = Type.Object(
  {
    project_key: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    board_type: Type.Optional(
      Type.Union([
        Type.Literal("scrum"),
        Type.Literal("kanban"),
        Type.Literal("simple"),
      ]),
    ),
    ...agilePageFields,
  },
  { additionalProperties: false },
);
const getBoardParameters = Type.Object(
  {
    board_id: Type.String(),
    include_sprints: Type.Optional(Type.Boolean()),
    sprint_states: Type.Optional(stringArray("Sprint states")),
    sprint_start_at: Type.Optional(
      Type.Number({ minimum: 0, maximum: 100000 }),
    ),
    sprint_limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    include_backlog: Type.Optional(Type.Boolean()),
    backlog_start_at: Type.Optional(
      Type.Number({ minimum: 0, maximum: 100000 }),
    ),
    backlog_limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    fields: Type.Optional(stringArray("Issue fields")),
    save_to_file: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
const getSprintParameters = Type.Object(
  {
    sprint_id: Type.String(),
    include_issues: Type.Optional(Type.Boolean()),
    fields: Type.Optional(stringArray("Issue fields")),
    ...agilePageFields,
  },
  { additionalProperties: false },
);
const downloadAttachmentParameters = Type.Object(
  { attachment_id: Type.String(), filename: Type.Optional(Type.String()) },
  { additionalProperties: false },
);
const estimateFields = {
  adjust_estimate: Type.Optional(
    Type.Union([
      Type.Literal("new"),
      Type.Literal("leave"),
      Type.Literal("manual"),
      Type.Literal("auto"),
    ]),
  ),
  new_estimate: Type.Optional(Type.String()),
  increase_by: Type.Optional(Type.String()),
};
const worklogFields = {
  time_spent: Type.Optional(
    Type.String({ description: "One time value is required for create" }),
  ),
  time_spent_seconds: Type.Optional(
    Type.Number({
      minimum: 1,
      description: "One time value is required for create",
    }),
  ),
  started: Type.Optional(Type.String()),
  comment: Type.Optional(Type.String()),
  comment_adf: Type.Optional(unknownRecord("Raw ADF worklog comment")),
  visibility: Type.Optional(visibilityObject),
  ...estimateFields,
  dry_run: Type.Optional(Type.Boolean()),
};
const manageWorklogParameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("create"),
      Type.Literal("update"),
      Type.Literal("delete"),
    ]),
    issue_key: Type.String(),
    worklog_id: Type.Optional(
      Type.String({ description: "Required for update and delete" }),
    ),
    ...worklogFields,
  },
  { additionalProperties: false },
);
const manageIssueLinkParameters = Type.Object(
  {
    action: Type.Union([Type.Literal("create"), Type.Literal("delete")]),
    issue_key: Type.String(),
    other_issue_key: Type.Optional(
      Type.String({ description: "Required for create" }),
    ),
    link_type: Type.Optional(
      Type.String({ description: "Required for create" }),
    ),
    direction: Type.Optional(
      Type.Union([Type.Literal("outward"), Type.Literal("inward")], {
        description: "Required for create",
      }),
    ),
    link_id: Type.Optional(Type.String({ description: "Required for delete" })),
    comment: Type.Optional(Type.String()),
    comment_adf: Type.Optional(unknownRecord("Raw ADF comment")),
    dry_run: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
const manageSprintParameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("create"),
      Type.Literal("update"),
      Type.Literal("start"),
      Type.Literal("close"),
      Type.Literal("delete"),
    ]),
    board_id: Type.Optional(
      Type.String({ description: "Required for create" }),
    ),
    sprint_id: Type.Optional(
      Type.String({ description: "Required for every action except create" }),
    ),
    name: Type.Optional(
      Type.String({ description: "Required for create; optional for update" }),
    ),
    goal: Type.Optional(Type.String()),
    start_date: Type.Optional(Type.String()),
    end_date: Type.Optional(Type.String()),
    dry_run: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
const manageBacklogParameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("move_to_backlog"),
      Type.Literal("move_to_sprint"),
      Type.Literal("rank"),
    ]),
    issue_key: Type.String(),
    sprint_id: Type.Optional(
      Type.String({ description: "Required for move_to_sprint" }),
    ),
    rank_before_issue_key: Type.Optional(
      Type.String({ description: "One rank anchor is required for rank" }),
    ),
    rank_after_issue_key: Type.Optional(
      Type.String({ description: "One rank anchor is required for rank" }),
    ),
    dry_run: Type.Optional(Type.Boolean()),
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
      "Find directory users or issue/project-assignable users. Directory search requires Jira Browse users and groups permission; omitted scope uses the configured default project when present.",
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
      "Search Jira Cloud issues with JQL. Continue with next_page_token; comments, worklogs, and changelog use numeric offsets on jira_get_issue. Saves raw JSON for analysis.",
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
    name: "jira_search_boards",
    group: "jira",
    baseRisk: "network",
    traits: ["read_only_network", "credentialed"],
    executionKind: "local",
    executor: executeJiraSearchBoards,
    label: "Jira Search Boards",
    description: "Search visible Jira Software boards.",
    promptSnippet: "Search Jira Software boards with narrow filters",
    promptGuidelines: [jiraGuideline],
    parameters: searchBoardsParameters,
    executionMode: "parallel",
  },
  {
    name: "jira_get_board",
    group: "jira",
    baseRisk: "network",
    traits: ["read_only_network", "credentialed"],
    executionKind: "local",
    executor: executeJiraGetBoard,
    label: "Jira Get Board",
    description:
      "Fetch one Jira Software board with optional sprints and backlog issues.",
    promptSnippet: "Fetch one Jira board and bounded agile data",
    promptGuidelines: [jiraGuideline],
    parameters: getBoardParameters,
    executionMode: "parallel",
  },
  {
    name: "jira_get_sprint",
    group: "jira",
    baseRisk: "network",
    traits: ["read_only_network", "credentialed"],
    executionKind: "local",
    executor: executeJiraGetSprint,
    label: "Jira Get Sprint",
    description: "Fetch one Jira sprint with optional issues.",
    promptSnippet: "Fetch one Jira sprint",
    promptGuidelines: [jiraGuideline],
    parameters: getSprintParameters,
    executionMode: "parallel",
  },
  {
    name: "jira_download_attachment",
    group: "jira",
    baseRisk: "network",
    traits: ["read_only_network", "credentialed"],
    executionKind: "local",
    executor: executeJiraDownloadAttachment,
    label: "Jira Download Attachment",
    description: "Download one Jira attachment to a local artifact.",
    promptSnippet: "Download one Jira attachment by id",
    promptGuidelines: [jiraGuideline],
    parameters: downloadAttachmentParameters,
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
    name: "jira_manage_comment",
    group: "jira",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeJiraManageComment,
    label: "Jira Manage Comment",
    description: "Create, update, or delete one Jira issue comment.",
    promptSnippet: "Manage one Jira comment only when explicitly requested",
    promptGuidelines: [jiraGuideline],
    parameters: manageCommentParameters,
    executionMode: "sequential",
  },
  {
    name: "jira_manage_worklog",
    group: "jira",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeJiraManageWorklog,
    label: "Jira Manage Worklog",
    description: "Create, update, or delete one Jira worklog.",
    promptSnippet: "Manage one Jira worklog only when explicitly requested",
    promptGuidelines: [jiraGuideline],
    parameters: manageWorklogParameters,
    executionMode: "sequential",
  },
  {
    name: "jira_manage_issue_link",
    group: "jira",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeJiraManageIssueLink,
    label: "Jira Manage Issue Link",
    description: "Create or delete one Jira issue link.",
    promptSnippet: "Manage one Jira issue link only when explicitly requested",
    promptGuidelines: [jiraGuideline],
    parameters: manageIssueLinkParameters,
    executionMode: "sequential",
  },
  {
    name: "jira_manage_attachment",
    group: "jira",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeJiraManageAttachment,
    label: "Jira Manage Attachment",
    description: "Upload or delete one Jira attachment.",
    promptSnippet: "Manage one Jira attachment only when explicitly requested",
    promptGuidelines: [jiraGuideline],
    parameters: jiraManageAttachmentParameters,
    executionMode: "sequential",
    classifyRisk: (args) =>
      args.action === "delete" ? "destructive" : "command",
  },
  {
    name: "jira_manage_sprint",
    group: "jira",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeJiraManageSprint,
    label: "Jira Manage Sprint",
    description: "Create, update, start, close, or delete one Jira sprint.",
    promptSnippet: "Manage one Jira sprint only when explicitly requested",
    promptGuidelines: [jiraGuideline],
    parameters: manageSprintParameters,
    executionMode: "sequential",
  },
  {
    name: "jira_manage_backlog",
    group: "jira",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeJiraManageBacklog,
    label: "Jira Manage Backlog",
    description: "Move or rank one Jira issue in a backlog or sprint.",
    promptSnippet: "Move or rank one Jira issue only when explicitly requested",
    promptGuidelines: [jiraGuideline],
    parameters: manageBacklogParameters,
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
] satisfies ToolDefinition[];
