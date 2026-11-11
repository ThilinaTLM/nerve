/**
 * Shared declarations of the generated `references/*.d.ts` files (guide
 * skill): the data shapes methods return. Method declarations come from the
 * method tables (see sdk-dts.ts). Each shape lives in the one file that uses
 * it most; the files are compiled together.
 */
export const JIRA_DTS_TYPES = `type Str = string | null;
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
  /** Present when named in \`fields\` (also attachment, subtasks: [key, summary, status] objects). */
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
}`;

export const CONFLUENCE_DTS_TYPES = `// FileHandle is declared in files.d.ts.

interface Space {
  id: string;
  key: string;
  name: string;
  type: string | null;
  url: string;
}

interface PageSummary {
  id: string;
  title: string | null;
  /** Space key. */
  space: string | null;
  url: string;
  updated: string | null;
  parentId: string | null;
}

interface Page {
  id: string;
  title: string | null;
  /** Space key. */
  space: string | null;
  url: string;
  version: number | null;
  parentId: string | null;
  labels: string[];
  /** Markdown (read-only view), or storage XHTML with body: "storage" (trusted: splice into a RichText array). */
  body?: string;
  /** First 100 direct children; only with children: true. */
  children?: { id: string; title: string | null }[];
}

/** A new page with attachments ends at version 2. */
interface PageWrite {
  id: string;
  title: string | null;
  url: string;
  version: number | null;
    fixes: string[];
  /** Left for you to fix with pages.update. */
  warnings: string[];
  attachments?: AttachmentInfo[];
}

/** Markdown (HTML escaped) | storage.* output (trusted markup) | array of those, joined. A string of storage XHTML is rejected: use storage.raw or an array. */
type RichText = string | RichText[];

type AttachmentInput = FileHandle | { file: FileHandle; filename?: string; comment?: string };

interface ConfluenceComment {
  id: string;
  author: string | null;
  created: string | null;
  body: string;
  parentId: string | null;
  inline?: { selection: string; resolved: boolean };
}

interface AttachmentInfo {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
  /** Bumped by a same-filename re-upload. */
  version?: number;
  comment?: string;
  width?: number;
  height?: number;
}`;

export const FILES_DTS_TYPES = `/** "artifact:<name>" (a file of this conversation) or a workspace path. */
type FileHandle = string;

interface ArtifactInfo {
  handle: FileHandle;
  name: string;
  bytes: number;
  mediaType: string;
  modified: string;
}

interface ImageInfo {
  format: "png" | "jpeg";
  width: number;
  height: number;
  bytes: number;
}`;

/** Chain steps that only build the pending operations; `info` and `save` come from the method table. */
export const IMAGE_CHAIN_OPS = `  /** fit "inside" (default) never enlarges. */
  resize(options: { width?: number; height?: number; fit?: "inside" | "cover" | "fill" }): ImageChain;
  /** Runs before resize. */
  crop(options: { left: number; top: number; width: number; height: number }): ImageChain;
  png(): ImageChain;
  jpeg(options?: { quality?: number }): ImageChain;`;

export const WEB_DTS_TYPES = `// FileHandle is declared in files.d.ts.
interface WebPage {
  url: string;
  status: number;
  contentType: string;
  title?: string;
  /** Markdown or text; the parsed value for JSON. */
  content: unknown;
}
interface WebHit {
  title: string;
  url: string;
  snippet: string;
  published?: string;
}`;

export const ATLASSIAN_DTS_TYPES = `interface AtlassianPerson {
  accountId: string;
  name: string;
  email?: string;
}
interface AtlassianDefaults {
  jira?: { site: string; project?: string; user: AtlassianPerson };
  confluence?: { site: string; space?: string; user: AtlassianPerson };
}`;
