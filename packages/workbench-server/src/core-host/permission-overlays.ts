import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { CoreStorage } from "@nervekit/conversation-core";
import { createId } from "@nervekit/contracts";
import {
  permissionOverlayDocumentForOriginSchema,
  type PermissionOverlayDocument,
  type PermissionOverlayOrigin,
} from "@nervekit/contracts/permissions";
import { assertHomeConfigurationPathWritable } from "../infrastructure/configuration/home-configuration.js";
import { atomicWriteJson } from "../infrastructure/storage-bootstrap/index.js";

export function emptyOverlayDocument(): PermissionOverlayDocument {
  return { schemaVersion: 2, overlays: [] };
}

export function overlayDigest(content: string | Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

/** Reads and validates an overlay file; a missing file is an empty document. */
export async function loadPermissionOverlay(
  origin: PermissionOverlayOrigin,
  path: string,
): Promise<PermissionOverlayDocument> {
  try {
    return permissionOverlayDocumentForOriginSchema(origin).parse(
      JSON.parse(await readFile(path, "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return emptyOverlayDocument();
    throw error;
  }
}

const writes = new Map<string, Promise<void>>();

/** Serializes read-modify-write cycles per file and validates before the atomic write. */
export async function mutatePermissionOverlay(
  origin: PermissionOverlayOrigin,
  path: string,
  mutate: (document: PermissionOverlayDocument) => void,
): Promise<void> {
  const write = (writes.get(path) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      if (origin === "user") {
        assertHomeConfigurationPathWritable(path);
        try {
          permissionOverlayDocumentForOriginSchema(origin).parse(
            JSON.parse(await readFile(path, "utf8")),
          );
        } catch (cause) {
          throw new Error(
            "Cannot save invalid permissions settings. Reset to defaults or fix the file and Reload first.",
            { cause },
          );
        }
      }
      const document = await loadPermissionOverlay(origin, path);
      mutate(document);
      const parsed =
        permissionOverlayDocumentForOriginSchema(origin).parse(document);
      await atomicWriteJson(path, parsed, 0o600);
    });
  writes.set(path, write);
  try {
    await write;
  } finally {
    if (writes.get(path) === write) writes.delete(path);
  }
}

/** Records the file's current bytes as trusted for the project. */
export async function trustProjectPermissions(
  storage: CoreStorage,
  projectId: string,
  path: string,
): Promise<void> {
  const contentDigest = overlayDigest(await readFile(path));
  const existing = storage.trustedResources.find(
    "project_permissions",
    projectId,
    path,
  );
  const now = new Date().toISOString();
  if (existing)
    storage.trustedResources.update(existing.id, {
      contentDigest,
      status: "trusted",
      updatedAt: now,
    });
  else
    storage.trustedResources.insert({
      id: createId("trust"),
      kind: "project_permissions",
      projectId,
      path,
      name: null,
      contentDigest,
      status: "trusted",
      createdAt: now,
      updatedAt: now,
    });
}
