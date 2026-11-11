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
  issuelinks?: { type: string | null; direction: "outward" | "inward"; key: string | null; summary: string | null }[];
  subtasks?: { key: string | null; summary: string | null; status: string | null }[];
  worklog?: { author: string | null; started: string | null; timeSpent: string | null; timeSpentSeconds: number | null; comment: string | null }[];
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
  author: string | null;
  created: string | null;
  /** Markdown. */
  body: string;
}

interface JiraProject {
  key: string;
  name: string | null;
  lead: JiraUser | null;
  issueTypes: string[];
  components: string[];
  versions: string[];
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
    /** `comments: true` adds all comments. */
    get(options: string | { key: string; fields?: string[]; comments?: boolean }): Promise<Issue & { comments?: IssueComment[] }>;
  };
  projects: {
    get(options: string | { key: string }): Promise<JiraProject>;
  };
  users: {
    search(options: string | { query: string }): Promise<JiraUser[]>;
  };
  fields: {
    /** Names usable in `fields`. */
    list(): Promise<JiraField[]>;
  };
  /** Path under /rest/api/3/ or /rest/agile/1.0/. Returns JSON or text; non-GET is a destructive write. */
  request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<unknown>;
};
