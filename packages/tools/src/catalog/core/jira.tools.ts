import { Type } from "typebox";
import type { CoreToolDefinition } from "../types.js";

const jiraGuideline =
  "Use Jira tools for ticket work only when the Jira module is enabled; keep JQL, fields, and result limits narrow, use saved JSON artifact paths for large analyses, and mutate tickets only when the user asked for Jira changes.";

const stringArray = (description: string) =>
  Type.Array(Type.String(), { description });
const unknownRecord = (description: string) =>
  Type.Record(Type.String(), Type.Any(), { description });

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
    components: Type.Optional(stringArray("Component names")),
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
    labels: Type.Optional(stringArray("Replacement labels")),
    priority: Type.Optional(Type.String({ description: "Priority name" })),
    fields: Type.Optional(
      unknownRecord("Additional raw Jira fields to merge into fields"),
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
    fields: Type.Optional(
      unknownRecord("Additional fields for the transition payload"),
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
    name: "jira_search_issues",
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
    label: "Jira Get Issue",
    description:
      "Fetch one Jira issue, optionally including comments and transitions.",
    promptSnippet: "Fetch a Jira issue by key or ID",
    promptGuidelines: [jiraGuideline],
    parameters: getIssueParameters,
    executionMode: "parallel",
  },
  {
    name: "jira_get_project",
    label: "Jira Get Project",
    description:
      "Fetch Jira project metadata, optionally including statuses, components, and versions.",
    promptSnippet: "Fetch Jira project metadata",
    promptGuidelines: [jiraGuideline],
    parameters: getProjectParameters,
    executionMode: "parallel",
  },
  {
    name: "jira_create_issue",
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
    label: "Jira Update Issue",
    description: "Update common Jira issue fields plus optional raw fields.",
    promptSnippet: "Update Jira issues only when explicitly requested",
    promptGuidelines: [jiraGuideline],
    parameters: updateIssueParameters,
    executionMode: "sequential",
  },
  {
    name: "jira_add_comment",
    label: "Jira Add Comment",
    description: "Add a Jira issue comment from plain text or raw ADF.",
    promptSnippet: "Add Jira comments only when explicitly requested",
    promptGuidelines: [jiraGuideline],
    parameters: addCommentParameters,
    executionMode: "sequential",
  },
  {
    name: "jira_transition_issue",
    label: "Jira Transition Issue",
    description:
      "Discover or execute Jira workflow transitions with safe matching and dry-run support.",
    promptSnippet: "Transition Jira issues only when explicitly requested",
    promptGuidelines: [jiraGuideline],
    parameters: transitionIssueParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];
