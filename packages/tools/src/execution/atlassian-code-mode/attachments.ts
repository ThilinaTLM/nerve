import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { image } from "@nervekit/native";
import { anyJson } from "../atlassian/http.js";
import { confluenceAttachmentRequest } from "../confluence/client.js";
import { valuesFromConfluenceList } from "../confluence/format.js";
import { detectImageKind, readImageSize } from "../confluence/image-size.js";
import { resolveToolPath } from "../filesystem/path.js";
import { objectArg, optionalText } from "./sdk-args.js";
import type {
  HostFile,
  NestedAuthorization,
  SdkEnvironment,
} from "./sdk-types.js";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type AttachmentSpec = {
  path?: string;
  file?: string;
  filename?: string;
  comment?: string;
};

export type UploadedAttachment = {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
  width?: number;
  height?: number;
};

/** Accepts `{ path | file, filename?, comment? }`; `file` is a `diagram.render` handle (or its id). */
export function parseAttachmentSpec(raw: unknown): AttachmentSpec {
  const options = objectArg(raw);
  const path = optionalText(options.path);
  const handle = options.file;
  const file =
    typeof handle === "string"
      ? handle
      : handle && typeof handle === "object"
        ? optionalText((handle as { file?: unknown }).file)
        : undefined;
  if (handle !== undefined && !file)
    throw new Error("file must be a handle returned by diagram.render().");
  if (Boolean(path) === Boolean(file)) {
    throw new Error(
      "Provide exactly one of path (workspace file) or file (diagram.render handle).",
    );
  }
  return {
    path,
    file,
    filename: optionalText(options.filename),
    comment: optionalText(options.comment),
  };
}

/** Direct-tool checks for reading the source file (the upload itself is authorized separately). */
export function attachmentReadAuthorizations(
  specs: AttachmentSpec[],
  env: SdkEnvironment,
): NestedAuthorization[] {
  return specs.flatMap((spec) => {
    if (!spec.path) return [];
    const path = resolveToolPath(env.context.cwd, spec.path);
    return [{ toolName: "read", args: { path }, summary: path }];
  });
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
      ...(spec.path ? { file_path: spec.path } : {}),
      ...(spec.filename ? { filename: spec.filename } : {}),
    },
    summary: `${pageId} ← ${spec.filename ?? spec.path ?? spec.file}`,
  }));
}

const MEDIA_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".zip": "application/zip",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

async function readSource(
  spec: AttachmentSpec,
  env: SdkEnvironment,
): Promise<HostFile> {
  if (spec.file) {
    const file = env.files.get(spec.file);
    if (!file)
      throw new Error(
        `Unknown file handle "${spec.file}"; it must come from diagram.render() in this script.`,
      );
    return file;
  }
  const path = resolveToolPath(env.context.cwd, spec.path);
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`Not a regular file: ${path}`);
  if (info.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `Attachment exceeds the 25 MiB upload limit (${info.size} bytes).`,
    );
  }
  return {
    bytes: await readFile(path),
    filename: basename(path),
    mediaType: "application/octet-stream",
  };
}

function withExtension(filename: string, extension: string): string {
  const current = extname(filename);
  return (current ? filename.slice(0, -current.length) : filename) + extension;
}

/**
 * Reads, validates and normalizes an attachment: SVG is rejected, GIF/WebP are
 * converted to PNG, and PNG/JPEG/GIF/WebP dimensions are read from headers.
 */
export async function loadAttachment(
  spec: AttachmentSpec,
  env: SdkEnvironment,
): Promise<HostFile> {
  const source = await readSource(spec, env);
  let filename = spec.filename ?? source.filename;
  const kind = detectImageKind(source.bytes);
  if (kind === "svg" || /\.svg$/i.test(filename)) {
    throw new Error(
      `SVG attachments are not supported (Confluence does not render them reliably): "${filename}". Render diagrams as PNG with diagram.render() or provide a PNG/JPEG.`,
    );
  }
  if (!kind) {
    return {
      bytes: source.bytes,
      filename,
      mediaType:
        MEDIA_TYPES[extname(filename).toLowerCase()] ?? source.mediaType,
    };
  }
  let bytes = source.bytes;
  let size = readImageSize(bytes, kind);
  if (!size) throw new Error(`Could not read the image size of "${filename}".`);
  let mediaType = kind === "jpeg" ? "image/jpeg" : "image/png";
  if (kind === "gif" || kind === "webp") {
    if (!image.isAvailable())
      throw new Error(
        `Converting ${kind.toUpperCase()} to PNG needs native image support, which is unavailable.`,
      );
    const prepared = await image.prepareImage(bytes, {
      maxDimension: Math.max(size.width, size.height),
      maxBase64Bytes: Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3),
      acceptedFormats: ["png", "jpeg"],
      outputFormats: ["png"],
    });
    bytes = prepared.data;
    size = { width: prepared.width, height: prepared.height };
    mediaType = "image/png";
    filename = withExtension(filename, ".png");
  }
  return { bytes, filename, mediaType, ...size };
}

export async function uploadAttachment(
  env: SdkEnvironment,
  pageId: string,
  file: HostFile,
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
