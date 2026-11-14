import { anyJson } from "./http.js";
import { confluenceAttachmentRequest } from "../confluence/client.js";
import { valuesFromConfluenceList } from "../confluence/format.js";
import type { ConfluenceSession } from "../confluence/session.js";
import { mediaTypeFor } from "./files.js";
import type { ToolAuthorization } from "@nervekit/extension-api";

/** One file to attach: any handle (`artifact:<name>` or a workspace path). */
export type AttachmentSpec = {
  file: string;
  filename?: string;
  comment?: string;
};

/** A file ready to upload, with image dimensions when the host knows them (PNG/JPEG). The host streams it from `handle`. */
export type LoadedAttachment = {
  handle: string;
  size: number;
  filename: string;
  mediaType: string;
  width?: number;
  height?: number;
};

export type UploadedAttachment = {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
  /** Attachment version; above 1 means a same-name upload replaced an existing file. */
  version?: number;
  width?: number;
  height?: number;
};

/** A handle string, or `{ file, filename?, comment? }`. */
export function parseAttachmentSpec(raw: unknown): AttachmentSpec {
  if (typeof raw === "string") return { file: raw };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      "an attachment is a file handle or { file, filename?, comment? }.",
    );
  }
  const { file, filename, comment, ...rest } = raw as Record<string, unknown>;
  const unknown = Object.keys(rest)[0];
  if (unknown) {
    throw new Error(
      `attachment has no option '${unknown}'; valid options: file, filename, comment.`,
    );
  }
  if (typeof file !== "string" || !file.trim()) {
    throw new Error(
      "attachment.file must be a file handle (`artifact:<name>` or a workspace path).",
    );
  }
  return {
    file,
    filename:
      typeof filename === "string" && filename.trim() ? filename : undefined,
    comment:
      typeof comment === "string" && comment.trim() ? comment : undefined,
  };
}

/** Workspace sources are checked as the direct `read` tool before anything is read; artifacts are the run's own files. */
export function attachmentReadAuthorizations(
  specs: readonly AttachmentSpec[],
): ToolAuthorization[] {
  return specs.flatMap(({ file }) =>
    file.startsWith("artifact:")
      ? []
      : [{ toolName: "read", args: { path: file }, summary: file }],
  );
}

/** Advice for files beyond the transfer limit. */
const ATTACHMENT_TOO_LARGE_HINT = "Split or compress it.";

/** Loads attachments one after another. */
export async function loadAttachments(
  specs: readonly AttachmentSpec[],
  session: ConfluenceSession,
): Promise<LoadedAttachment[]> {
  const loaded: LoadedAttachment[] = [];
  for (const spec of specs) loaded.push(await loadAttachment(spec, session));
  return loaded;
}

/**
 * Describes an attachment without reading it: SVG is rejected, and PNG/JPEG
 * get their dimensions from the host. The host streams the file on upload
 * (up to 100 MB).
 */
export async function loadAttachment(
  spec: AttachmentSpec,
  session: ConfluenceSession,
): Promise<LoadedAttachment> {
  const info = await session.ctx.artifacts
    .info(spec.file)
    .catch((error: unknown) => {
      if (error instanceof Error && /the limit is/.test(error.message))
        error.message = `${error.message.replace(/ Process it with .*$/, "")} ${ATTACHMENT_TOO_LARGE_HINT}`;
      throw error;
    });
  const filename = spec.filename ?? info.name;
  if (/\.svg$/i.test(filename) || info.mediaType === "image/svg+xml") {
    throw new Error(
      `SVG attachments are not supported (Confluence does not render them reliably): "${filename}". Render diagrams as PNG with diagram.render() or provide a PNG/JPEG.`,
    );
  }
  return {
    handle: spec.file,
    size: info.bytes,
    filename,
    mediaType: mediaTypeFor(filename),
    ...(info.width && info.height
      ? { width: info.width, height: info.height }
      : {}),
  };
}

export async function uploadAttachment(
  session: ConfluenceSession,
  pageId: string,
  file: LoadedAttachment,
  comment?: string,
): Promise<UploadedAttachment> {
  const data = await confluenceAttachmentRequest(session.connection, {
    parse: anyJson,
    method: "PUT",
    pageId,
    parts: [
      {
        name: "file",
        filename: file.filename,
        mediaType: file.mediaType,
        data: { handle: file.handle },
      },
      { name: "minorEdit", value: "true" },
      ...(comment ? [{ name: "comment", value: comment }] : []),
    ],
  });
  const raw = (valuesFromConfluenceList(data)[0] ?? data) as {
    id?: unknown;
    title?: unknown;
    extensions?: { mediaType?: unknown; fileSize?: unknown };
    version?: { number?: unknown };
  };
  return {
    id: String(raw.id ?? ""),
    filename: typeof raw.title === "string" ? raw.title : file.filename,
    mediaType:
      typeof raw.extensions?.mediaType === "string"
        ? raw.extensions.mediaType
        : file.mediaType,
    size:
      typeof raw.extensions?.fileSize === "number"
        ? raw.extensions.fileSize
        : file.size,
    ...(typeof raw.version?.number === "number"
      ? { version: raw.version.number }
      : {}),
    ...(file.width ? { width: file.width, height: file.height } : {}),
  };
}
