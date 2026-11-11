/**
 * Shared declarations of the generated `references/*.d.ts` files (guide
 * skill): the data shapes methods return. Method declarations come from the
 * method tables (see sdk-dts.ts). Each shape lives in the one file that uses
 * it most; the files are compiled together.
 */
export const JIRA_DTS_TYPES = `interface JiraUser {
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
  /** Present when named in \`fields\`. */
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
  /** Markdown, or storage XHTML with body: "storage"; absent with body: false. */
  body?: string;
  /** First 100 direct children; only with children: true. */
  children?: { id: string; title: string | null }[];
}

/** A new page with attachments is saved twice, so its version is then 2. */
interface PageWrite {
  id: string;
  title: string | null;
  url: string;
  version: number | null;
  /** Corrections the linter applied. */
  fixes: string[];
  /** Problems left for you to fix with pages.update. */
  warnings: string[];
  attachments?: AttachmentInfo[];
}

type AttachmentInput = FileHandle | { file: FileHandle; filename?: string; comment?: string };

interface AttachmentInfo {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
  /** Pixel size of images. */
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
