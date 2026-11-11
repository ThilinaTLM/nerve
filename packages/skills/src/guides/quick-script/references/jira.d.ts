// GENERATED from the method tables (sdk-dts.test.ts); regenerate with UPDATE_SDK_DTS=1.
// jira.d.ts: sandbox globals and the shapes they return.

interface JiraUser {
  name: string | null;
  email: string | null;
  accountId: string | null;
}

interface Issue {
  key: string;
  id: string;
  url: string;
  summary: string | null;
  status: string | null;
  statusCategory: string | null;
  type: string | null;
  priority: string | null;
  assignee: JiraUser | null;
  reporter: JiraUser | null;
  created: string | null;
  updated: string | null;
  resolution: string | null;
  labels: string[];
  components: string[];
  fixVersions: string[];
  parent: { key: string; summary: string | null } | null;
  /** Markdown. issues.get returns it; issues.search only if requested. */
  description?: string | null;
  /** Present when named in `fields`. */
  comment?: IssueComment[];
  attachment?: { id: string | null; filename: string | null; size: number | null; mimeType: string | null }[];
  issuelinks?: { id: string | null; type: string | null; direction: "outward" | "inward"; key: string | null; summary: string | null }[];
  subtasks?: { key: string | null; summary: string | null; status: string | null }[];
  worklog?: { id: string | null; author: string | null; started: string | null; timeSpent: string | null; timeSpentSeconds: number | null; comment: string | null }[];
  timetracking?: {
    originalEstimate: string | null;
    remainingEstimate: string | null;
    timeSpent: string | null;
    originalEstimateSeconds: number | null;
    remainingEstimateSeconds: number | null;
    timeSpentSeconds: number | null;
  };
  /** Other requested fields, keyed by the name you passed (options become strings, users names, rich text Markdown). */
  [field: string]: unknown;
}

interface IssueComment {
  id: string | null;
  author: string | null;
  created: string | null;
  /** Markdown. */
  body: string;
}

interface IssueTransition {
  name: string;
  /** Target status. */
  to: string;
  requiredFields: string[];
}

interface JiraProject {
  key: string;
  name: string | null;
  lead: JiraUser | null;
  issueTypes: string[];
  components: string[];
  versions: string[];
  /** include "fields": what each issue type's create screen takes. */
  createFields?: {
    issueType: string;
    subtask: boolean;
    fields: { name: string; required: boolean; type: string; allowed?: string[] }[];
  }[];
  /** include "statuses": "Name (category)" per issue type. */
  statuses?: { issueType: string; statuses: string[] }[];
  /** include "releases": unarchived fix versions, unreleased first. */
  releases?: { name: string; released: boolean; releaseDate: string | null; startDate: string | null }[];
  boards?: { id: number; name: string; type: string | null }[];
  sprints?: { id: number; name: string; state: string | null; startDate: string | null; endDate: string | null; goal: string | null; boardId: number }[];
  epics?: { key: string; summary: string | null; status: string | null }[];
}

interface JiraField {
  id: string;
  name: string;
  custom: boolean;
  type: string | null;
}

declare const jira: {
  issues: {
    /** JQL needs a field restriction; a bare ORDER BY is rejected. `fields` replaces the default set. limit default 50, max 1000. */
    search(options: string | { jql: string; fields?: string[]; limit?: number }): Promise<Issue[]>;
    /** `comments: true` adds all comments as `comments` (replacing `comment`); `transitions: true` the statuses it can move to, with their required fields. */
    get(options: string | { key: string; fields?: string[]; comments?: boolean; transitions?: boolean }): Promise<Issue & { comments?: IssueComment[]; transitions?: IssueTransition[] }>;
    /** Markdown description. `fields` take field names (jira.fields.list) and plain values: users by email/name, options/priority/components by name, Markdown for rich text. Missing required fields or invalid values throw with the valid ones listed. */
    create(options: { project?: string; type: string; summary: string; description?: string; fields?: Record<string, unknown> }): Promise<{ key: string; id: string; url: string }>;
    /** Sets the given fields (replacing their values), same value rules as create; assign with { Assignee: "ann@example.com" } or null to unassign. */
    update(options: { key: string; fields: Record<string, unknown> }): Promise<{ key: string; url: string; updated: string[] }>;
    /** `to` is the target status name. Required transition fields (e.g. Resolution) go in `fields`; missing ones or an unreachable status throw with the valid choices. */
    transition(options: { key: string; to: string; fields?: Record<string, unknown>; comment?: string }): Promise<{ key: string; status: string; url: string }>;
    /** `type` is a link type name or phrase: "Blocks", "blocks" (key blocks to), "is blocked by". Unknown types throw with the valid ones. */
    link(options: { key: string; to: string; type: string }): Promise<{ key: string; to: string; type: string }>;
    /** Moves up to 50 issues into a sprint (id from projects.get include "sprints") or back to the backlog. */
    move(options: { keys: string[]; sprint: number | "backlog" }): Promise<{ moved: number }>;
    /** Destructive. Permanently deletes the issue; `subtasks: true` also deletes its subtasks (required if it has any). */
    delete(options: string | { key: string; subtasks?: boolean }): Promise<{ key: string }>;
  };
  projects: {
    /** `include` adds, for learning a project's conventions: "fields" (create fields per issue type with required/allowed values; `issueType` limits it to one), "statuses" per issue type, "releases" (fix versions), "boards", "sprints" (active/future; "closedSprints" adds the 10 latest closed per board), "epics" (open). */
    get(options: string | { key: string; include?: ("fields" | "statuses" | "releases" | "boards" | "sprints" | "closedSprints" | "epics")[]; issueType?: string }): Promise<JiraProject>;
    /** Every project you can see. */
    list(): Promise<{ key: string; name: string; type: string }[]>;
  };
  users: {
    search(options: string | { query: string }): Promise<JiraUser[]>;
    /** The authenticated user. */
    me(): Promise<{ accountId: string; name: string; email: string | null; timeZone: string | null }>;
  };
  fields: {
    /** Names usable in `fields`. */
    list(): Promise<JiraField[]>;
  };
  comments: {
    /** Markdown body. */
    add(options: { key: string; body: string }): Promise<{ id: string; url: string }>;
    /** Replaces the comment text (Markdown). */
    update(options: { key: string; id: string; body: string }): Promise<{ id: string }>;
    /** Destructive. */
    delete(options: { key: string; id: string }): Promise<{ id: string }>;
  };
  worklogs: {
    /** `time` like "1h 30m"; `started` any ISO date-time (default now). */
    add(options: { key: string; time: string; started?: string; comment?: string }): Promise<{ id: string; timeSpent: string }>;
  };
  attachments: {
    /** Any file handle; max 25 MB. */
    upload(options: { key: string; file: FileHandle; filename?: string }): Promise<{ id: string; filename: string; mediaType: string; size: number }>;
    /** Saves the attachment as `artifact:<its filename>` (or `name`); max 20 MB. */
    download(options: string | { id: string; name?: string }): Promise<FileHandle>;
  };
  adf: {
    /** For raw jira.request bodies; never for Confluence pages. */
    fromMarkdown(markdown: string): object;
    /** For raw jira.request responses (ADF documents); never for Confluence pages. */
    toMarkdown(doc: object): string;
  };
  /** Destructive unless GET. Path under /rest/api/3/ or /rest/agile/1.0/. Returns JSON or text, or a FileHandle for binary responses. `query` values may be arrays (repeated). */
  request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, query?: Record<string, string | number | boolean | (string | number)[]>): Promise<unknown>;
};
