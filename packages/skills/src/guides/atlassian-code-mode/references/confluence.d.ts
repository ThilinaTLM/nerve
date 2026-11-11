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
}

declare const confluence: {
  spaces: {
    /** Contains match on key or name. */
    search(options?: string | { query?: string }): Promise<Space[]>;
  };
  pages: {
    /** Needs cql, space or title (contains); ANDed. limit default 25, max 250. */
    search(options: string | { cql?: string; space?: string; title?: string; limit?: number }): Promise<PageSummary[]>;
    /** By id, or by exact title (space defaults to the configured one). body defaults to "markdown". */
    get(options: string | { id: string; body?: "markdown" | "storage" | false; children?: boolean } | { space?: string; title: string; body?: "markdown" | "storage" | false; children?: boolean }): Promise<Page>;
    /** body is storage XHTML from storage.*, linted on write. Pass attachments for images the body references. */
    create(options: { space?: string; title: string; parent?: string; body: string; format?: "storage" | "markdown"; toc?: boolean; attachments?: AttachmentInput[] }): Promise<PageWrite>;
    /** Replaces the whole body (read body: "storage" first to edit); omitted title/body are kept. */
    update(options: { id: string; title?: string; body?: string; format?: "storage" | "markdown"; message?: string; toc?: boolean; attachments?: AttachmentInput[] }): Promise<PageWrite>;
  };
  attachments: {
    /** Same filename replaces. SVG rejected; max 20 MB. */
    upload(options: { id: string; file: FileHandle; filename?: string; comment?: string }): Promise<AttachmentInfo>;
  };
  labels: {
    add(options: { id: string; labels: string | string[] }): Promise<{ id: string; labels: string[] }>;
  };
  comments: {
    /** Footer comment; Markdown unless format is "storage". */
    add(options: { id: string; body: string; format?: "markdown" | "storage" }): Promise<{ id: string; pageId: string }>;
  };
  /** Path under /wiki/api/v2/ or /wiki/rest/api/. Returns JSON or text; non-GET is a destructive write. */
  request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<unknown>;
};
