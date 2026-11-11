import {
  lstat,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { extname, join } from "node:path";
import { image } from "@nervekit/native";
import { resolveToolPath } from "../filesystem/path.js";
import type {
  ArtifactReport,
  NestedAuthorization,
  SdkEnvironment,
} from "./sdk-types.js";

/**
 * Artifacts: files a script produces, kept in one folder per conversation
 * (`context.conversationArtifactDir`). Scripts name them with string handles:
 * `artifact:<name>` for the folder, anything else is a workspace path.
 */

/** Files crossing the JSON bridge, and the largest file read at all. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const ARTIFACT_PREFIX = "artifact:";
// Letters, digits, `_`, `.`, `-`; no separators, no leading dot.
const ARTIFACT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

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

export function artifactDir(env: SdkEnvironment): string {
  const dir = env.context.conversationArtifactDir;
  if (!dir) throw new Error("Artifacts are not available in this context.");
  return dir;
}

export function assertArtifactName(name: unknown): string {
  if (typeof name !== "string" || !ARTIFACT_NAME.test(name)) {
    throw new Error(
      `Invalid artifact name ${JSON.stringify(name)}: use 1-128 letters, digits, '.', '_' or '-' (no folders, no leading dot).`,
    );
  }
  return name;
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
export function readAuthorizations(refs: FileRef[]): NestedAuthorization[] {
  return refs.flatMap((ref) =>
    ref.kind === "workspace"
      ? [{ toolName: "read", args: { path: ref.path }, summary: ref.path }]
      : [],
  );
}

export async function readFileRef(
  ref: FileRef,
  maxBytes = MAX_FILE_BYTES,
): Promise<Buffer> {
  const info =
    ref.kind === "artifact" ? await lstat(ref.path) : await stat(ref.path);
  if (!info.isFile()) throw new Error(`Not a regular file: ${ref.handle}`);
  if (info.size > maxBytes) {
    throw new Error(
      `${ref.handle} is ${info.size} bytes; the limit is ${maxBytes}.`,
    );
  }
  return await readFile(ref.path);
}

/** Writes an artifact (creating the folder on first use) and records it for the result report. */
export async function writeArtifact(
  env: SdkEnvironment,
  name: string,
  bytes: Uint8Array,
): Promise<string> {
  assertArtifactName(name);
  const dir = artifactDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, name);
  await writeFile(path, bytes, { mode: 0o600 });
  const handle = `${ARTIFACT_PREFIX}${name}`;
  env.report.artifacts.set(handle, {
    handle,
    path,
    bytes: bytes.byteLength,
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
    if (!entry.isFile() || !ARTIFACT_NAME.test(entry.name)) continue;
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
