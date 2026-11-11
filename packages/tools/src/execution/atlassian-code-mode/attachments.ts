import { extname } from "node:path";
import { image } from "@nervekit/native";
import { anyJson } from "../atlassian/http.js";
import { confluenceAttachmentRequest } from "../confluence/client.js";
import { valuesFromConfluenceList } from "../confluence/format.js";
import {
  mediaTypeFor,
  parseHandle,
  readAuthorizations,
  readFileRef,
} from "./artifacts.js";
import type { NestedAuthorization, SdkEnvironment } from "./sdk-types.js";

/** One file to attach: any handle (`artifact:<name>` or a workspace path). */
export type AttachmentSpec = {
  file: string;
  filename?: string;
  comment?: string;
};

/** A file ready to upload, with image dimensions when it is an image. */
export type LoadedAttachment = {
  bytes: Buffer;
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

/**
 * Reads, validates and normalizes an attachment: SVG is rejected, GIF/WebP are
 * converted to PNG, and image dimensions come from the native image module.
 */
export async function loadAttachment(
  spec: AttachmentSpec,
  env: SdkEnvironment,
): Promise<LoadedAttachment> {
  const ref = parseHandle(spec.file, env);
  let bytes = await readFileRef(ref);
  let filename =
    spec.filename ??
    (ref.kind === "artifact" ? ref.name : ref.path.split(/[\\/]/).pop()!);
  const kind = sniffImage(bytes);
  if (kind === "svg" || /\.svg$/i.test(filename)) {
    throw new Error(
      `SVG attachments are not supported (Confluence does not render them reliably): "${filename}". Render diagrams as PNG with diagram.render() or provide a PNG/JPEG.`,
    );
  }
  if (!kind) return { bytes, filename, mediaType: mediaTypeFor(filename) };
  let info = await image.imageInfo(bytes);
  let mediaType = kind === "jpeg" ? "image/jpeg" : "image/png";
  if (kind === "gif" || kind === "webp") {
    const converted = await image.transformImage(bytes, { format: "png" });
    bytes = converted.data;
    info = { format: "png", width: converted.width, height: converted.height };
    mediaType = "image/png";
    filename = withExtension(filename, ".png");
  }
  return { bytes, filename, mediaType, width: info.width, height: info.height };
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
    new Blob([new Uint8Array(file.bytes)], { type: file.mediaType }),
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
        : file.bytes.byteLength,
    ...(file.width ? { width: file.width, height: file.height } : {}),
  };
}
