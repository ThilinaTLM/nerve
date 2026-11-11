import { openAsBlob } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { extname } from "node:path";
import { image } from "@nervekit/native";
import { anyJson } from "../../atlassian/http.js";
import { confluenceAttachmentRequest } from "../../confluence/client.js";
import { valuesFromConfluenceList } from "../../confluence/format.js";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_FILE_BYTES,
  mediaTypeFor,
  parseHandle,
  readAuthorizations,
  statFileRef,
} from "../files/artifacts.js";
import type { NestedAuthorization, SdkEnvironment } from "../sdk-types.js";

/** One file to attach: any handle (`artifact:<name>` or a workspace path). */
export type AttachmentSpec = {
  file: string;
  filename?: string;
  comment?: string;
};

/**
 * A file ready to upload, with image dimensions when it is an image. The bytes
 * are streamed from `path` unless an image was converted (`bytes`, then in memory).
 */
export type LoadedAttachment = {
  path: string;
  size: number;
  bytes?: Buffer;
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

/** Workspace sources are checked as the direct `read` tool before anything is read. */
export function attachmentReadAuthorizations(
  specs: AttachmentSpec[],
  env: SdkEnvironment,
): NestedAuthorization[] {
  return readAuthorizations(specs.map((spec) => parseHandle(spec.file, env)));
}

export function attachmentUploadAuthorizations(
  pageId: string,
  specs: AttachmentSpec[],
): NestedAuthorization[] {
  return specs.map((spec) => ({
    toolName: "confluence_manage_attachment",
    args: {
      action: "upload",
      page_id: pageId,
      file_path: spec.file,
      ...(spec.filename ? { filename: spec.filename } : {}),
    },
    summary: `${pageId} ← ${spec.filename ?? spec.file}`,
  }));
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
  const head = Buffer.from(bytes.subarray(0, 1024))
    .toString("utf8")
    .trimStart();
  return /^(<\?xml[\s\S]*?)?<svg[\s>]/i.test(head) ? "svg" : undefined;
}

function withExtension(filename: string, extension: string): string {
  const current = extname(filename);
  return (current ? filename.slice(0, -current.length) : filename) + extension;
}

/** Advice for files beyond the transfer limit. */
const ATTACHMENT_TOO_LARGE_HINT = "Split or compress it.";

/** Bytes read to recognize an image (the SVG check looks at the first 1 KiB). */
const SNIFF_BYTES = 1100;

async function readHead(path: string): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(head, 0, SNIFF_BYTES, 0);
    return head.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Loads attachments one after another; files are only checked here and streamed when uploaded. */
export async function loadAttachments(
  specs: readonly AttachmentSpec[],
  env: SdkEnvironment,
): Promise<LoadedAttachment[]> {
  const loaded: LoadedAttachment[] = [];
  for (const spec of specs) loaded.push(await loadAttachment(spec, env));
  return loaded;
}

/**
 * Checks and describes an attachment without reading it into memory: SVG is
 * rejected, and PNG/JPEG/GIF/WebP up to 20 MB are read for their dimensions
 * (GIF/WebP are converted to PNG). Larger images upload unchanged.
 */
export async function loadAttachment(
  spec: AttachmentSpec,
  env: SdkEnvironment,
  maxBytes = MAX_ATTACHMENT_BYTES,
): Promise<LoadedAttachment> {
  const ref = parseHandle(spec.file, env);
  const size = await statFileRef(ref, maxBytes, ATTACHMENT_TOO_LARGE_HINT);
  let filename =
    spec.filename ??
    (ref.kind === "artifact" ? ref.name : ref.path.split(/[\\/]/).pop()!);
  const kind = sniffImage(await readHead(ref.path));
  if (kind === "svg" || /\.svg$/i.test(filename)) {
    throw new Error(
      `SVG attachments are not supported (Confluence does not render them reliably): "${filename}". Render diagrams as PNG with diagram.render() or provide a PNG/JPEG.`,
    );
  }
  const plain = {
    path: ref.path,
    size,
    filename,
    mediaType: mediaTypeFor(filename),
  };
  if (!kind || size > MAX_FILE_BYTES) return plain;
  const original = await readFile(ref.path);
  let info = await image.imageInfo(original);
  if (kind === "jpeg" || kind === "png") {
    return {
      ...plain,
      mediaType: kind === "jpeg" ? "image/jpeg" : "image/png",
      width: info.width,
      height: info.height,
    };
  }
  const converted = await image.transformImage(original, { format: "png" });
  info = { format: "png", width: converted.width, height: converted.height };
  filename = withExtension(filename, ".png");
  return {
    path: ref.path,
    size: converted.data.byteLength,
    bytes: Buffer.from(converted.data),
    filename,
    mediaType: "image/png",
    width: info.width,
    height: info.height,
  };
}

export async function uploadAttachment(
  env: SdkEnvironment,
  pageId: string,
  file: LoadedAttachment,
  comment?: string,
): Promise<UploadedAttachment> {
  const form = new FormData();
  form.append(
    "file",
    file.bytes
      ? new Blob([new Uint8Array(file.bytes)], { type: file.mediaType })
      : await openAsBlob(file.path, { type: file.mediaType }),
    file.filename,
  );
  form.append("minorEdit", "true");
  if (comment) form.append("comment", comment);
  const data = await confluenceAttachmentRequest(await env.confluence(), {
    parse: anyJson,
    method: "PUT",
    pageId,
    form,
    signal: env.context.signal,
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
