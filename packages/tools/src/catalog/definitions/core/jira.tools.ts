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
} from "../../../execution/jira/jira.js";
import { jiraManageAttachmentParameters } from "./jira-attachment.schema.js";
import type { ToolDefinition } from "../../contracts.js";

const stringArray = () => Type.Array(Type.String());
const unknownRecord = () => Type.Record(Type.String(), Type.Any());
const positiveInteger = (maximum = 100) => Type.Number({ minimum: 0, maximum });

const visibilityObject = Type.Object(
  {
    type: Type.String(),
    value: Type.String(),
  },
  { additionalProperties: false },
);

const searchUsersParameters = Type.Object(
  {
    query: Type.String(),
    project_key: Type.Optional(
      Type.String({
        description: "Defaults to configured project.",
      }),
    ),
    issue_key: Type.Optional(Type.String()),
    max_results: Type.Optional(
      Type.Number({
        description: "Default: 10.",
        minimum: 1,
        maximum: 50,
      }),
    ),
    include_inactive: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const searchIssuesParameters = Type.Object(
  {
    jql: Type.String({
      description: "Requires a field restriction; not ORDER BY alone.",
    }),
    fields: Type.Optional(stringArray()),
    max_results: Type.Optional(
      Type.Number({
        description: "Default: 25.",
        minimum: 1,
        maximum: 100,
      }),
    ),
    next_page_token: Type.Optional(
      Type.String({
        description: "From the preceding search.",
      }),
    ),
  },
  { additionalProperties: false },
);

const getIssueParameters = Type.Object(
  {
    issue_key: Type.String(),
    fields: Type.Optional(stringArray()),
    include: Type.Optional(
      Type.Array(
        Type.Enum([
          "comments",
          "transitions",
          "editmeta",
          "worklogs",
          "changelog",
          "remote_links",
          "issue_links",
          "attachments",
        ]),
        { uniqueItems: true },
      ),
    ),
    comment_start_at: Type.Optional(positiveInteger(100000)),
    worklog_start_at: Type.Optional(positiveInteger(100000)),
    changelog_start_at: Type.Optional(positiveInteger(100000)),
    related_limit: Type.Optional(positiveInteger(100)),
  },
  { additionalProperties: false },
);

const getProjectParameters = Type.Object(
  {
    project_key: Type.Optional(
      Type.String({ description: "Defaults from settings." }),
    ),
    include: Type.Optional(
      Type.Array(
        Type.Enum([
          "statuses",
          "components",
          "versions",
          "issue_types",
          "create_meta",
          "fields",
          "priorities",
          "resolutions",
          "issue_link_types",
        ]),
        { uniqueItems: true },
      ),
    ),
    issue_type: Type.Optional(Type.String()),
    field_query: Type.Optional(Type.String()),
    field_limit: Type.Optional(positiveInteger(100)),
  },
  { additionalProperties: false },
);

const createIssueParameters = Type.Object(
  {
    project_key: Type.Optional(
      Type.String({ description: "Defaults from settings." }),
    ),
    issue_type: Type.String(),
    summary: Type.String(),
    description: Type.Optional(
      Type.String({
        description: "Plain text; not with description_adf.",
      }),
    ),
    description_adf: Type.Optional(unknownRecord()),
    parent_key: Type.Optional(Type.String()),
    labels: Type.Optional(stringArray()),
    priority: Type.Optional(Type.String()),
    assignee_account_id: Type.Optional(Type.String()),
    assignee_query: Type.Optional(Type.String()),
    components: Type.Optional(stringArray()),
    dry_run: Type.Optional(Type.Boolean()),
    return_issue: Type.Optional(Type.Boolean()),
    fields: Type.Optional(unknownRecord()),
  },
  { additionalProperties: false },
);

const updateIssueParameters = Type.Object(
  {
    issue_key: Type.String(),
    summary: Type.Optional(Type.String()),
    description: Type.Optional(
      Type.String({
        description: "Plain text; not with description_adf.",
      }),
    ),
    description_adf: Type.Optional(unknownRecord()),
    assignee_account_id: Type.Optional(Type.String()),
    assignee_query: Type.Optional(Type.String()),
    labels: Type.Optional(stringArray()),
    priority: Type.Optional(Type.String()),
    fields: Type.Optional(unknownRecord()),
    update: Type.Optional(unknownRecord()),
    notify_users: Type.Optional(Type.Boolean()),
    dry_run: Type.Optional(Type.Boolean()),
    return_issue: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const commentBodyFields = {
  body: Type.Optional(
    Type.String({
      description: "Required for create/update unless body_adf is set.",
    }),
  ),
  body_adf: Type.Optional(unknownRecord()),
  visibility: Type.Optional(visibilityObject),
  dry_run: Type.Optional(Type.Boolean()),
};
const manageCommentParameters = Type.Object(
  {
    action: Type.Enum(["create", "update", "delete"]),
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
};
const searchBoardsParameters = Type.Object(
  {
    project_key: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    board_type: Type.Optional(Type.Enum(["scrum", "kanban", "simple"])),
    ...agilePageFields,
  },
  { additionalProperties: false },
);
const getBoardParameters = Type.Object(
  {
    board_id: Type.String(),
    include: Type.Optional(
      Type.Array(Type.Enum(["sprints", "backlog"]), { uniqueItems: true }),
    ),
    sprint_states: Type.Optional(stringArray()),
    sprint_start_at: Type.Optional(
      Type.Number({ minimum: 0, maximum: 100000 }),
    ),
    sprint_limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    backlog_start_at: Type.Optional(
      Type.Number({ minimum: 0, maximum: 100000 }),
    ),
    backlog_limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    fields: Type.Optional(stringArray()),
  },
  { additionalProperties: false },
);
const getSprintParameters = Type.Object(
  {
    sprint_id: Type.String(),
    include_issues: Type.Optional(Type.Boolean()),
    fields: Type.Optional(stringArray()),
    ...agilePageFields,
  },
  { additionalProperties: false },
);
const downloadAttachmentParameters = Type.Object(
  { attachment_id: Type.String(), filename: Type.Optional(Type.String()) },
  { additionalProperties: false },
);
const estimateFields = {
  adjust_estimate: Type.Optional(Type.Enum(["new", "leave", "manual", "auto"])),
  new_estimate: Type.Optional(Type.String()),
  increase_by: Type.Optional(Type.String()),
};
const worklogFields = {
  time_spent: Type.Optional(
    Type.String({ description: "Create needs this or time_spent_seconds." }),
  ),
  time_spent_seconds: Type.Optional(Type.Number({ minimum: 1 })),
  started: Type.Optional(Type.String()),
  comment: Type.Optional(Type.String()),
  comment_adf: Type.Optional(unknownRecord()),
  visibility: Type.Optional(visibilityObject),
  ...estimateFields,
  dry_run: Type.Optional(Type.Boolean()),
};
const manageWorklogParameters = Type.Object(
  {
    action: Type.Enum(["create", "update", "delete"]),
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
    action: Type.Enum(["create", "delete"]),
    issue_key: Type.String(),
    other_issue_key: Type.Optional(
      Type.String({ description: "Required for create" }),
    ),
    link_type: Type.Optional(
      Type.String({ description: "Required for create" }),
    ),
    direction: Type.Optional(
      Type.Enum(["outward", "inward"], {
        description: "Required for create",
      }),
    ),
    link_id: Type.Optional(Type.String({ description: "Required for delete" })),
    comment: Type.Optional(Type.String()),
    comment_adf: Type.Optional(unknownRecord()),
    dry_run: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
const manageSprintParameters = Type.Object(
  {
    action: Type.Enum(["create", "update", "start", "close", "delete"]),
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
    action: Type.Enum(["move_to_backlog", "move_to_sprint", "rank"]),
    issue_key: Type.String(),
    sprint_id: Type.Optional(
      Type.String({ description: "Required for move_to_sprint" }),
    ),
    rank_before_issue_key: Type.Optional(
      Type.String({ description: "Rank needs this or rank_after_issue_key." }),
    ),
    rank_after_issue_key: Type.Optional(Type.String()),
    dry_run: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const transitionIssueParameters = Type.Object(
  {
    issue_key: Type.String(),
    transition: Type.Optional(
      Type.String({
        description: "ID, transition name, or destination status.",
      }),
    ),
    resolution: Type.Optional(Type.String()),
    comment: Type.Optional(Type.String()),
    comment_adf: Type.Optional(unknownRecord()),
    fields: Type.Optional(unknownRecord()),
    update: Type.Optional(unknownRecord()),
    dry_run: Type.Optional(Type.Boolean()),
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
    description: "Find directory or assignable Jira users.",
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
    description: "Search Jira issues with JQL and save raw JSON.",
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
    description: "Fetch a Jira issue and optional related data.",
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
    description: "Fetch Jira project metadata.",
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
    description: "Fetch a Jira board and optional sprints/backlog.",
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
      "Create a Jira issue using typed common fields plus optional raw fields. Only on explicit user request.",
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
    description:
      "Update common Jira issue fields plus optional raw fields. Only on explicit user request.",
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
    description:
      "Create, update, or delete one Jira issue comment. Only on explicit user request.",
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
    description:
      "Create, update, or delete one Jira worklog. Only on explicit user request.",
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
    description:
      "Create or delete one Jira issue link. Only on explicit user request.",
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
    description:
      "Upload or delete one Jira attachment. Only on explicit user request.",
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
    description:
      "Create, update, start, close, or delete one Jira sprint. Only on explicit user request.",
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
    description:
      "Move or rank one Jira issue in a backlog or sprint. Only on explicit user request.",
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
      "List or execute Jira workflow transitions. Only on explicit user request.",
    parameters: transitionIssueParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
