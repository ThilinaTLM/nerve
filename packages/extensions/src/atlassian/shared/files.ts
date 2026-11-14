import { extname } from "node:path";
import { isArtifactName } from "@nervekit/extension-api";

export const ARTIFACT_PREFIX = "artifact:";

/** Largest file the host reads into memory (`ctx.artifacts.read`, JSON responses). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Attachment uploads and downloads stream between disk and the network. */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

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
