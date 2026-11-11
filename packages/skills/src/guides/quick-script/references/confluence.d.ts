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
  /** Markdown (read-only view), or storage XHTML with body: "storage" (trusted RichText: splice it into an array); absent with body: false. */
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

/** Markdown string (HTML in it is escaped) | storage.* output (trusted markup) | array of those, joined. A string that is really storage XHTML is rejected; use storage.raw or an array. */
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
  /** Attachment version (list); a re-upload of the same filename adds one. */
  version?: number;
  comment?: string;
  /** Pixel size of images. */
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
    /** By id, or by exact title (space defaults to the configured one). body "markdown" (default) is for reading only (mentions as @Name, tasks as - [ ], add-on macros as [drawio macro: name]); to edit use body: "storage", which can be spliced into a RichText array or storage.replaceSection. */
    get(options: string | { id: string; body?: "markdown" | "storage" | false; children?: boolean } | { space?: string; title: string; body?: "markdown" | "storage" | false; children?: boolean }): Promise<Page>;
    /** body is RichText (Markdown, storage.* output, or an array of both), linted on write. Pass attachments for files the body references. */
    create(options: { space?: string; title: string; parent?: string; body: RichText; toc?: boolean; attachments?: AttachmentInput[] }): Promise<PageWrite>;
    /** Replaces the whole body (omitted title/body keep the page's). To edit: [page.body, "## New", ...] appends, storage.replaceSection(page.body, heading, content) swaps one section, or pages.download + edit the file + bodyFile. body (RichText) and bodyFile (storage file) are exclusive. Dropping existing macros/layouts/images/mentions throws unless allowRemoving. Pass the version you read; a newer page throws CONFLICT. */
    update(options: { id: string; version?: number; title?: string; body?: RichText; bodyFile?: FileHandle; allowRemoving?: boolean; message?: string; toc?: boolean; attachments?: AttachmentInput[] }): Promise<PageWrite>;
    /** Saves the storage body as artifact:page-<id>.xhtml. Edit it (Edit tool or files.edit), then pages.update({ id, version, bodyFile: file }). attachments: true also saves the page's attachments. */
    download(options: { id: string; attachments?: boolean }): Promise<{ file: FileHandle; version: number; title: string; attachments?: { filename: string; file: FileHandle }[]; skipped?: string[] }>;
    /** Give exactly one target: parent (becomes its last child), before or after (a sibling page id). A target in another space moves the page there, with its children. */
    move(options: { id: string; parent: string } | { id: string; before: string } | { id: string; after: string }): Promise<{ id: string; position: "append" | "before" | "after"; target: string }>;
    /** Destructive. Moves the page to the trash (restorable with pages.restore); purge: true deletes it for good. */
    delete(options: string | { id: string; purge?: boolean }): Promise<{ id: string; title: string | null; status: "trashed" | "purged" }>;
    /** Restores a trashed page (its content is kept). */
    restore(id: string | { id: string }): Promise<{ id: string; title: string | null; url: string; version: number | null }>;
  };
  attachments: {
    /** Same filename replaces. SVG rejected; max 100 MB. */
    upload(options: { id: string; file: FileHandle; filename?: string; comment?: string }): Promise<AttachmentInfo>;
    /** By attachment id, or by page id and exact filename. Max 100 MB. */
    download(options: { id: string } | { page: string; filename: string }): Promise<FileHandle>;
    /** Attachments of a page (id = page id). Upload with the same filename = new version. */
    list(id: string | { id: string }): Promise<AttachmentInfo[]>;
    /** Destructive. Deletes an attachment (id from attachments.list). */
    delete(id: string | { id: string }): Promise<{ id: string }>;
  };
  comments: {
    /** Footer and inline comments of a page, replies included (parentId). inline: true/false limits to one kind; resolved filters inline comments only. */
    list(options: string | { id: string; inline?: boolean; resolved?: boolean }): Promise<ConfluenceComment[]>;
    /** Footer comment, or with inline: { text, occurrence? } a comment anchored to text of the page (exact rendered text; occurrence is 1-based and required when text appears more than once). body is RichText (Markdown, storage.* output, or an array of both). */
    add(options: { id: string; body: RichText; inline?: { text: string; occurrence?: number } }): Promise<{ id: string; pageId: string }>;
    /** Replaces a footer or inline comment's text. body is RichText. */
    update(options: { id: string; body: RichText }): Promise<{ id: string }>;
    /** Destructive. Deletes a footer or inline comment and its replies. */
    delete(id: string | { id: string }): Promise<{ id: string }>;
    /** Replies to a footer or inline comment (id = parent comment id). body is RichText. */
    reply(options: { id: string; body: RichText }): Promise<{ id: string; parentId: string }>;
    /** Resolves (default) or reopens an inline comment. */
    resolve(options: { id: string; resolved?: boolean }): Promise<{ id: string; resolved: boolean }>;
  };
  labels: {
    /** Labels are lowercase without spaces: case is folded and spaces become "-"; other punctuation (including ".") throws. */
    add(options: { id: string; labels: string | string[] }): Promise<{ id: string; labels: string[] }>;
    remove(options: { id: string; labels: string | string[] }): Promise<{ id: string; labels: string[] }>;
  };
  /** Destructive unless GET. Path under /wiki/api/v2/ or /wiki/rest/api/. Returns JSON or text, a FileHandle for binary (page bodies: use pages.create/update). */
  request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, query?: Record<string, string | number | boolean | string[]>): Promise<unknown>;
};
