// GENERATED from the method tables (sdk-dts.test.ts); regenerate with UPDATE_SDK_DTS=1.
// confluence.d.ts: sandbox globals and the shapes they return.

// FileHandle is declared in files.d.ts.

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
}

declare const confluence: {
  spaces: {
    /** Contains match on key or name. */
    search(options?: string | { query?: string }): Promise<Space[]>;
  };
  pages: {
    /** Needs cql, space or title (contains); ANDed. limit default 25, max 250. */
    search(options: string | { cql?: string; space?: string; title?: string; limit?: number }): Promise<PageSummary[]>;
    /** By id or exact title (space defaults to the configured one). body "markdown" (default) is read-only (@Name, - [ ], [drawio macro: name] placeholders); to edit use "storage". */
    get(options: string | ({ id: string } | { space?: string; title: string }) & { body?: "markdown" | "storage" | false; children?: boolean }): Promise<Page>;
    /** Linted on write. Pass `attachments` for files the body references. */
    create(options: { space?: string; title: string; parent?: string; body: RichText; toc?: boolean; attachments?: AttachmentInput[] }): Promise<PageWrite>;
    /** Replaces the whole body. Edit: [page.body, "## New"], storage.replaceSection(page.body, heading, content), or pages.download + bodyFile (exclusive with body). Dropping macros/layouts/images/mentions throws unless allowRemoving. Pass the version you read (CONFLICT if newer). */
    update(options: { id: string; version?: number; title?: string; body?: RichText; bodyFile?: FileHandle; allowRemoving?: boolean; message?: string; toc?: boolean; attachments?: AttachmentInput[] }): Promise<PageWrite>;
    /** Saves storage XHTML as artifact:page-<id>.xhtml; edit it, then pages.update({ id, version, bodyFile: file }). attachments: true also saves attachments. */
    download(options: { id: string; attachments?: boolean }): Promise<{ file: FileHandle; version: number; title: string; attachments?: { filename: string; file: FileHandle }[]; skipped?: string[] }>;
    /** One target: parent (last child), before or after (sibling id). Another space moves the page and children there. */
    move(options: { id: string } & ({ parent: string } | { before: string } | { after: string })): Promise<{ id: string; position: "append" | "before" | "after"; target: string }>;
    /** Destructive. Trashes the page (pages.restore undoes); purge: true deletes for good. */
    delete(options: string | { id: string; purge?: boolean }): Promise<{ id: string; title: string | null; status: "trashed" | "purged" }>;
    restore(id: string | { id: string }): Promise<{ id: string; title: string | null; url: string; version: number | null }>;
  };
  attachments: {
    /** Same filename replaces. SVG rejected; max 100 MB. */
    upload(options: { id: string; file: FileHandle; filename?: string; comment?: string }): Promise<AttachmentInfo>;
    /** By attachment id, or by page id and exact filename. Max 100 MB. */
    download(options: { id: string } | { page: string; filename: string }): Promise<FileHandle>;
    /** Of a page (id = page id). */
    list(id: string | { id: string }): Promise<AttachmentInfo[]>;
    /** Destructive. id from attachments.list. */
    delete(id: string | { id: string }): Promise<{ id: string }>;
  };
  comments: {
    /** Footer and inline comments incl. replies (parentId). inline: true/false limits to one kind; resolved filters inline. */
    list(options: string | { id: string; inline?: boolean; resolved?: boolean }): Promise<ConfluenceComment[]>;
    /** Footer comment, or with inline: { text, occurrence? } anchored to exact rendered page text (1-based occurrence, required if text repeats). */
    add(options: { id: string; body: RichText; inline?: { text: string; occurrence?: number } }): Promise<{ id: string; pageId: string }>;
    update(options: { id: string; body: RichText }): Promise<{ id: string }>;
    /** Destructive. Also deletes replies. */
    delete(id: string | { id: string }): Promise<{ id: string }>;
    /** id is the parent comment. */
    reply(options: { id: string; body: RichText }): Promise<{ id: string; parentId: string }>;
    /** Resolves (default) or reopens an inline comment. */
    resolve(options: { id: string; resolved?: boolean }): Promise<{ id: string; resolved: boolean }>;
  };
  labels: {
    /** Labels are lowercase without spaces: case is folded and spaces become "-"; other punctuation (including ".") throws. */
    add(options: { id: string; labels: string | string[] }): Promise<{ id: string; labels: string[] }>;
    remove(options: { id: string; labels: string | string[] }): Promise<{ id: string; labels: string[] }>;
  };
  /** Destructive unless GET. Path under /wiki/api/v2/ or /wiki/rest/api/; binary returns a FileHandle. Page bodies: use pages.create/update. */
  request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, query?: Record<string, string | number | boolean | string[]>): Promise<unknown>;
};
