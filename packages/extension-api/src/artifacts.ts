import { isArtifactName } from "./errors.js";

/** Artifact handles are `artifact:<name>`; anything else is a workspace path. */
export const ARTIFACT_PREFIX = "artifact:";

/** Largest file that streams between disk and the network (attachment uploads/downloads, raw downloads); never held in memory or the sandbox. */
export const MAX_STREAMED_FILE_BYTES = 100 * 1024 * 1024;

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

/** Media type from the file extension (case-insensitive), `application/octet-stream` when unknown. */
export function mediaTypeFor(filename: string): string {
  const base = filename.slice(
    Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\")) + 1,
  );
  const dot = base.lastIndexOf(".");
  const extension = dot > 0 ? base.slice(dot).toLowerCase() : "";
  return MEDIA_TYPES[extension] ?? "application/octet-stream";
}
