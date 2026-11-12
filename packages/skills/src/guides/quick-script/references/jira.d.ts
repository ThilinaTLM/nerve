// GENERATED from the method tables (sdk-dts.test.ts); regenerate with UPDATE_SDK_DTS=1.
// jira.d.ts: sandbox globals and the shapes they return.

type Str = string | null;
type Num = number | null;
type Fields = Record<string, unknown>;

interface WorklogRef {
  id: string;
  timeSpent: string;
}

/** created and author only in attachments.list. */
interface JiraAttachment {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
  created?: Str;
  author?: Str;
}

interface JiraUser {
  name: Str;
  email: Str;
  accountId: Str;
}

interface Issue {
  key: string;
  id: string;
  url: string;
  summary: Str;
  status: Str;
  statusCategory: Str;
  type: Str;
  priority: Str;
  assignee: JiraUser | null;
  reporter: JiraUser | null;
  created: Str;
  updated: Str;
  resolution: Str;
  labels: string[];
  components: string[];
  fixVersions: string[];
  parent: { key: string; summary: Str } | null;
  /** Markdown. issues.get returns it; issues.search only if requested. */
  description?: Str;
  /** Present when named in `fields` (also attachment, subtasks: [key, summary, status] objects). */
  comment?: IssueComment[];
  issuelinks?: { id: Str; type: Str; direction: "outward" | "inward"; key: Str; summary: Str }[];
  worklog?: { id: Str; author: Str; started: Str; timeSpent: Str; timeSpentSeconds: Num; comment: Str }[];
  /** originalEstimate, remainingEstimate, timeSpent and their …Seconds. */
  timetracking?: Record<string, string | number | null>;
  /** Other requested fields by the name you passed (options as strings, users as names, rich text as Markdown). */
  [field: string]: unknown;
}

interface IssueComment {
  id: Str;
  author: Str;
  created: Str;
  /** Markdown. */
  body: string;
}

interface IssueTransition {
  name: string;
  to: string;
  requiredFields: string[];
}

interface Sprint {
  id: number;
  name: string;
  state: Str;
  startDate: Str;
  endDate: Str;
  goal: Str;
  boardId: number;
}

interface JiraProject {
  key: string;
  name: Str;
  lead: JiraUser | null;
  issueTypes: string[];
  components: string[];
  versions: string[];
  createFields?: {
    issueType: string;
    subtask: boolean;
    fields: { name: string; required: boolean; type: string; allowed?: string[] }[];
  }[];
  statuses?: { issueType: string; statuses: string[] }[];
  releases?: { name: string; released: boolean; releaseDate: Str; startDate: Str }[];
  boards?: { id: number; name: string; type: Str }[];
  sprints?: Sprint[];
  epics?: { key: string; summary: Str; status: Str }[];
}

interface JiraField {
  id: string;
  name: string;
  custom: boolean;
  type: Str;
}

declare const jira: {
  issues: {
    /** JQL needs a field restriction; a bare ORDER BY is rejected. `fields` replaces the default set. limit default 50, max 1000. */
    search(options: string | { jql: string; fields?: string[]; limit?: number }): Promise<Issue[]>;
    /** `comments: true` adds all comments; `transitions: true` adds reachable statuses with requiredFields. */
    get(options: string | { key: string; fields?: string[]; comments?: boolean; transitions?: boolean }): Promise<Issue & { comments?: IssueComment[]; transitions?: IssueTransition[] }>;
    /** Markdown description; `![](name.png)` embeds an `attachments` image. `fields`: names (jira.fields.list), plain values (users by email/name, options by name, Markdown for rich text). Missing or invalid values throw listing the valid ones. */
    create(options: { project?: string; type: string; summary: string; description?: string; fields?: Fields; attachments?: AttachmentInput[] }): Promise<{ key: string; id: string; url: string; attachments?: { id: string; filename: string }[] }>;
    /** Replaces the given fields; values as in create; null unassigns. */
    update(options: { key: string; fields: Fields }): Promise<{ key: string; url: string; updated: string[] }>;
    /** `to` is a status name. Required transition fields (e.g. Resolution) go in `fields`; errors list the valid choices. */
    transition(options: { key: string; to: string; fields?: Fields; comment?: string }): Promise<{ key: string; status: string; url: string }>;
    /** `type`: link type name or phrase ("Blocks", "is blocked by"); unknown throws the valid ones. */
    link(options: { key: string; to: string; type: string }): Promise<{ key: string; to: string; type: string }>;
    /** Max 50 issues into a sprint (id: projects.get include "sprints") or "backlog". */
    move(options: { keys: string[]; sprint: number | "backlog" }): Promise<{ moved: number }>;
    /** Reorders up to 50 issues before or after another; pass exactly one of before/after. */
    rank(options: { keys: string[]; before?: string; after?: string }): Promise<{ ranked: number }>;
    /** Destructive. Removes links between two issues (either direction); `type` only if linked several ways. */
    unlink(options: { key: string; to: string; type?: string }): Promise<{ key: string; to: string; removed: number }>;
    /** Destructive. `subtasks: true` also deletes subtasks (required if any). */
    delete(options: string | { key: string; subtasks?: boolean }): Promise<{ key: string }>;
  };
  projects: {
    /** `include` adds: "fields" (create fields per issue type with required/allowed; `issueType` limits), "statuses", "releases", "boards", "sprints" (active/future; "closedSprints" adds 10 latest per board), "epics" (open). */
    get(options: string | { key: string; include?: ("fields" | "statuses" | "releases" | "boards" | "sprints" | "closedSprints" | "epics")[]; issueType?: string }): Promise<JiraProject>;
    list(): Promise<{ key: string; name: string; type: string }[]>;
  };
  users: {
    search(options: string | { query: string }): Promise<JiraUser[]>;
    me(): Promise<{ accountId: string; name: string; email: string | null; timeZone: string | null }>;
  };
  fields: {
    list(): Promise<JiraField[]>;
  };
  comments: {
    add(options: { key: string; body: string }): Promise<{ id: string; url: string }>;
    update(options: { key: string; id: string; body: string }): Promise<{ id: string }>;
    /** Destructive. */
    delete(options: { key: string; id: string }): Promise<{ id: string }>;
  };
  worklogs: {
    /** `time` like "1h 30m"; `started` any ISO date-time (default now). */
    add(options: { key: string; time: string; started?: string; comment?: string }): Promise<WorklogRef>;
    /** All worklogs of an issue (the `worklog` field of issues.get stops at 20). */
    list(options: string | { key: string }): Promise<NonNullable<Issue["worklog"]>>;
    /** Ids from worklogs.list; only given parts change. */
    update(options: { key: string; id: string; time?: string; started?: string; comment?: string }): Promise<WorklogRef>;
    /** Destructive. */
    delete(options: { key: string; id: string }): Promise<{ id: string }>;
  };
  attachments: {
    /** Max 100 MB. A repeated filename adds a duplicate (unlike Confluence). */
    upload(options: { key: string; file: FileHandle; filename?: string }): Promise<JiraAttachment>;
    /** Oldest first; `![](filename)` embeds the newest duplicate. */
    list(options: string | { key: string }): Promise<JiraAttachment[]>;
    /** Destructive. */
    delete(options: string | { id: string }): Promise<{ id: string }>;
    /** Saves as `artifact:<filename>` (or `name`); max 100 MB. */
    download(options: string | { id: string; name?: string }): Promise<FileHandle>;
  };
  sprints: {
    /** Creates a future sprint; `board` defaults to the project's only scrum board. */
    create(options: { board?: number; project?: string; name: string; goal?: string; startDate?: string; endDate?: string }): Promise<Sprint>;
    update(options: { id: number; name?: string; goal?: string; startDate?: string; endDate?: string }): Promise<Sprint>;
    /** Starts a future sprint now. Needs `endDate` or `duration` ("2w", "10d") unless the sprint already has an end date. */
    start(options: { id: number; endDate?: string; duration?: string }): Promise<Sprint>;
    /** Closes an active sprint. Open (not Done) issues stay in the closed sprint unless `moveOpenTo` names a sprint id or "backlog". */
    close(options: { id: number; moveOpenTo?: number | "backlog" }): Promise<Sprint & { moved: string[] }>;
    /** Like issues.search within the sprint; limit default 50, max 1000. */
    issues(options: number | { id: number; fields?: string[]; jql?: string; limit?: number }): Promise<Issue[]>;
    /** Destructive. Jira deletes future sprints only. */
    delete(options: number | { id: number }): Promise<{ id: number }>;
  };
  adf: {
    fromMarkdown(markdown: string): object;
    toMarkdown(doc: object): string;
  };
  /** Destructive unless GET. Path under /rest/api/3/ or /rest/agile/1.0/. Binary responses return a FileHandle; array query values repeat. */
  request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, query?: Record<string, string | number | boolean | (string | number)[]>): Promise<unknown>;
};
