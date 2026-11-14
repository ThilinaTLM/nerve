import { anyJson } from "./http.js";
import { confluenceAttachmentRequest } from "../confluence/client.js";
import { valuesFromConfluenceList } from "../confluence/format.js";
import type { ConfluenceSession } from "../confluence/session.js";
import { mediaTypeFor } from "./files.js";
import { imageSize } from "./image-size.js";
import type { ToolAuthorization } from "@nervekit/extension-api";

/** One file to attach: any handle (`artifact:<name>` or a workspace path). */
export type AttachmentSpec = {
  file: string;
  filename?: string;
  comment?: string;
};

/** A file ready to upload, with image dimensions when the host knows them (PNG/JPEG). */
export type LoadedAttachment = {
  bytes: Uint8Array;
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

type ImageKind = "png" | "jpeg" | "gif" | "webp" | "svg";

function sniffImage(bytes: Uint8Array): ImageKind | undefined {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  if (ascii(0, 3) === "GIF") return "gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  const head = new TextDecoder().decode(bytes.subarray(0, 1024)).trimStart();
  return /^(<\?xml[\s\S]*?)?<svg[\s>]/i.test(head) ? "svg" : undefined;
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
 * Reads and describes an attachment: SVG is rejected, and PNG/JPEG/GIF get
 * their dimensions from the header. The host reads files up to 20 MB.
 */
export async function loadAttachment(
  spec: AttachmentSpec,
  session: ConfluenceSession,
): Promise<LoadedAttachment> {
  const { artifacts } = session.ctx;
  const file = await artifacts.read(spec.file).catch((error: unknown) => {
    if (error instanceof Error && /the limit is/.test(error.message))
      error.message = `${error.message.replace(/ Process it with .*$/, "")} ${ATTACHMENT_TOO_LARGE_HINT}`;
    throw error;
  });
  const filename = spec.filename ?? file.name;
  if (sniffImage(file.bytes) === "svg" || /\.svg$/i.test(filename)) {
    throw new Error(
      `SVG attachments are not supported (Confluence does not render them reliably): "${filename}". Render diagrams as PNG with diagram.render() or provide a PNG/JPEG.`,
    );
  }
  const plain = {
    bytes: file.bytes,
    size: file.bytes.byteLength,
    filename,
    mediaType: mediaTypeFor(filename),
  };
  const kind = sniffImage(file.bytes);
  if (!kind) return plain;
  const size = imageSize(file.bytes);
  return {
    ...plain,
    ...(kind === "jpeg" ? { mediaType: "image/jpeg" } : {}),
    ...(kind === "png" ? { mediaType: "image/png" } : {}),
    ...(size ?? {}),
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
        data: file.bytes,
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
