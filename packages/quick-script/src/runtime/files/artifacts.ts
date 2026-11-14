import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { image } from "@nervekit/native";
import type { BinarySink } from "../../extensions/atlassian/shared/raw-request.js";
import { codedError } from "../errors.js";
import { resolveToolPath } from "@nervekit/tools/execution";
import type {
  ArtifactReport,
  DirectAuthorization,
  SdkEnvironment,
} from "../sdk-types.js";

/**
 * Artifacts: files a script produces, kept in one folder per conversation
 * (`<conversationDir>/quick-script`). Scripts name them with string handles:
 * `artifact:<name>` for the folder, anything else is a workspace path.
 */

/** Files crossing the JSON bridge (`files.read`/`files.write` data), and the largest file read into the sandbox. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Attachment upload/download and raw binary downloads stream between disk and the network; they never enter memory or the sandbox. */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export const ARTIFACT_PREFIX = "artifact:";
// Unicode letters and digits, space, `_`, `.`, `-`; no separators, no leading dot or space, no trailing space.
const ARTIFACT_NAME = /^[\p{L}\p{N}_][\p{L}\p{N} ._-]{0,127}$/u;

const isArtifactName = (name: string): boolean =>
  ARTIFACT_NAME.test(name) && !name.endsWith(" ");

/**
 * An artifact name for a foreign file name (an attachment title): kept as is
 * when valid, otherwise folders, control and other unsupported characters
 * become `_`, leading dots are dropped and the extension survives truncation.
 */
export function artifactNameFor(filename: string, fallback = "attachment") {
  if (isArtifactName(filename)) return filename;
  const extension = extname(filename).replace(/[^\p{L}\p{N}.]/gu, "");
  const stem = filename
    .slice(0, filename.length - extname(filename).length)
    .replace(/[^\p{L}\p{N} ._-]+/gu, "_")
    .replace(/^[. _-]+/, "")
    .trimEnd();
  const kept = extension.slice(-20);
  const name = `${stem.slice(0, 128 - kept.length)}${kept}`.trimEnd();
  return isArtifactName(name) ? name : fallback;
}

const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
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

export function mediaTypeFor(filename: string): string {
  return (
    MEDIA_TYPES[extname(filename).toLowerCase()] ?? "application/octet-stream"
  );
}

export type FileRef =
  | { kind: "artifact"; name: string; path: string; handle: string }
  | { kind: "workspace"; path: string; handle: string };

const formatMb = (bytes: number): string =>
  `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

export function artifactDir(env: SdkEnvironment): string {
  const dir = env.context.conversationDir;
  if (!dir) throw new Error("Artifacts are not available in this context.");
  return join(dir, "quick-script");
}

export function assertArtifactName(name: unknown): string {
  if (typeof name !== "string" || !isArtifactName(name)) {
    throw new Error(
      `Invalid artifact name ${JSON.stringify(name)}: use 1-128 letters, digits, spaces, '.', '_' or '-' (no folders, no leading dot).`,
    );
  }
  return name;
}

/** `name` or `artifact:name` (a handle from another call) to the bare, validated name. */
export function artifactNameOf(nameOrHandle: unknown): string {
  return assertArtifactName(
    typeof nameOrHandle === "string" && nameOrHandle.startsWith(ARTIFACT_PREFIX)
      ? nameOrHandle.slice(ARTIFACT_PREFIX.length)
      : nameOrHandle,
  );
}

export function parseHandle(handle: unknown, env: SdkEnvironment): FileRef {
  if (typeof handle !== "string" || !handle.trim()) {
    throw new Error(
      "A file handle is `artifact:<name>` or a workspace path string.",
    );
  }
  if (handle.startsWith(ARTIFACT_PREFIX)) {
    const name = assertArtifactName(handle.slice(ARTIFACT_PREFIX.length));
    return {
      kind: "artifact",
      name,
      path: join(artifactDir(env), name),
      handle,
    };
  }
  return {
    kind: "workspace",
    path: resolveToolPath(env.context.cwd, handle),
    handle,
  };
}

/** Workspace reads are checked as the direct `read` tool; artifacts are the tool's own files. */
export function readAuthorizations(refs: FileRef[]): DirectAuthorization[] {
  return refs.flatMap((ref) =>
    ref.kind === "workspace"
      ? [{ toolName: "read", args: { path: ref.path }, summary: ref.path }]
      : [],
  );
}

/** Checks a handle is a regular file within `maxBytes` and returns its size, without reading it. */
export async function statFileRef(
  ref: FileRef,
  maxBytes = MAX_FILE_BYTES,
  tooLargeHint = "Process it with the bash or python tools instead.",
): Promise<number> {
  const info = await (
    ref.kind === "artifact" ? lstat(ref.path) : stat(ref.path)
  ).catch(async (error: NodeJS.ErrnoException) => {
    throw error.code === "ENOENT" ? await notFound(ref) : error;
  });
  if (!info.isFile()) throw new Error(`Not a regular file: ${ref.handle}`);
  if (info.size > maxBytes) {
    throw new Error(
      `${ref.handle} is ${formatMb(info.size)}; the limit is ${formatMb(maxBytes)}. ${tooLargeHint}`,
    );
  }
  return info.size;
}

export async function readFileRef(
  ref: FileRef,
  maxBytes = MAX_FILE_BYTES,
  tooLargeHint = "Process it with the bash or python tools instead.",
): Promise<Buffer> {
  await statFileRef(ref, maxBytes, tooLargeHint);
  return await readFile(ref.path);
}

/** A missing file by its handle, never its host path; for artifacts it lists what exists. */
export async function notFound(ref: FileRef): Promise<Error> {
  if (ref.kind === "workspace") {
    return codedError("NOT_FOUND", `file not found: ${ref.handle}`);
  }
  const names = await readdir(dirname(ref.path)).catch(() => []);
  const shown = names.filter(isArtifactName).sort().slice(0, MAX_LISTED_NAMES);
  const more = names.length - shown.length;
  return codedError(
    "NOT_FOUND",
    `artifact "${ref.name}" not found; files.list() shows: ${shown.length > 0 ? shown.join(", ") + (more > 0 ? `, +${more} more` : "") : "(no artifacts yet)"}`,
  );
}

const MAX_LISTED_NAMES = 10;

/** Writes an artifact (creating the folder on first use) and records it for the result report. */
export async function writeArtifact(
  env: SdkEnvironment,
  name: string,
  bytes: Uint8Array,
): Promise<string> {
  assertArtifactName(name);
  const dir = artifactDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, name), bytes, { mode: 0o600 });
  return reportArtifact(env, name, bytes.byteLength);
}

/**
 * A fresh path inside the artifact folder for a download in progress. The name
 * starts with a dot, so listings and handles never expose it.
 */
export async function artifactTempPath(env: SdkEnvironment): Promise<string> {
  const dir = artifactDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return join(dir, `.${randomUUID()}.part`);
}

/** Moves a finished download into place as artifact `name` and records it; removes the temp file on failure. */
export async function commitArtifact(
  env: SdkEnvironment,
  tempPath: string,
  name: string,
): Promise<string> {
  try {
    assertArtifactName(name);
    const { size } = await stat(tempPath);
    await rename(tempPath, join(artifactDir(env), name));
    return reportArtifact(env, name, size);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

/** Streams a binary `request()` response into a fresh `<base>-N<ext>` artifact. */
export function artifactBinarySink(
  env: SdkEnvironment,
  base: string,
  extensionFor: (contentType: string) => string,
): BinarySink {
  return {
    prepare: () => artifactTempPath(env),
    commit: async (path, _bytes, contentType) =>
      await commitArtifact(
        env,
        path,
        await freshArtifactName(env, base, extensionFor(contentType)),
      ),
  };
}

/** Records an artifact the run wrote or changed for the result report; returns its handle. */
export function reportArtifact(
  env: SdkEnvironment,
  name: string,
  bytes: number,
): string {
  const handle = `${ARTIFACT_PREFIX}${name}`;
  env.report.artifacts.set(handle, {
    handle,
    path: join(artifactDir(env), name),
    bytes,
    mediaType: mediaTypeFor(name),
  });
  return handle;
}

export async function listArtifacts(env: SdkEnvironment) {
  const dir = artifactDir(env);
  const entries = await readdir(dir, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isArtifactName(entry.name)) continue;
    const info = await stat(join(dir, entry.name));
    files.push({
      handle: `${ARTIFACT_PREFIX}${entry.name}`,
      name: entry.name,
      bytes: info.size,
      mediaType: mediaTypeFor(entry.name),
      modified: info.mtime.toISOString(),
    });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/** `base-1.png`, `base-2.png`, ... — the first name not yet in the folder. */
export async function freshArtifactName(
  env: SdkEnvironment,
  base: string,
  extension: string,
): Promise<string> {
  const taken = new Set((await listArtifacts(env)).map((file) => file.name));
  // Parallel renders in one run have not reached the folder yet.
  for (const handle of env.report.artifacts.keys()) {
    taken.add(handle.slice(ARTIFACT_PREFIX.length));
  }
  for (let index = 1; ; index++) {
    const name = `${base}-${index}${extension}`;
    if (!taken.has(name)) return name;
  }
}

/** Adds the pixel size to PNG/JPEG artifacts so the tool card can reserve their preview. */
export async function withImageSizes(
  artifacts: readonly ArtifactReport[],
): Promise<ArtifactReport[]> {
  return await Promise.all(
    artifacts.map(async (artifact) => {
      if (
        artifact.mediaType !== "image/png" &&
        artifact.mediaType !== "image/jpeg"
      ) {
        return artifact;
      }
      try {
        const info = await image.imageInfo(await readFile(artifact.path));
        return { ...artifact, width: info.width, height: info.height };
      } catch {
        return artifact;
      }
    }),
  );
}
