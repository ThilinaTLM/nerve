import type {
  ProjectMigrationService,
  ProjectConfigurationContext,
} from "../../infrastructure/configuration/project-migration/project-migration.js";
import {
  projectPermissionsConfiguration,
  projectPermissionValue,
} from "./project-permission-migrations.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultUserConfiguration } from "@nervekit/contracts/settings";
import {
  trustedWrite,
  type TrustStorage,
} from "../../infrastructure/configuration/trusted-write.js";
type ProjectOverlayContext = {
  context: ProjectConfigurationContext;
  migrations: ProjectMigrationService;
};
function projectContext(
  path: string,
  project: ProjectOverlayContext | undefined,
): ProjectOverlayContext {
  if (
    !project ||
    resolve(path) !==
      resolve(
        project.context.directory,
        ".nerve",
        projectPermissionsConfiguration.path,
      )
  )
    throw new Error(
      "Project permission loading requires its migration context",
    );
  project.migrations.register(projectPermissionsConfiguration);
  return project;
}
import { createHash } from "node:crypto";
import { KeyedSerialQueue } from "@nervekit/primitives";
import { readFile } from "node:fs/promises";
import type { CoreStorage } from "@nervekit/conversation-core";
import { createId } from "@nervekit/contracts";
import {
  permissionOverlayDocumentForOriginSchema,
  type PermissionOverlayDocument,
  type PermissionOverlayOrigin,
} from "@nervekit/contracts/permissions";
import { assertHomeConfigurationPathWritable } from "../../infrastructure/configuration/home-configuration.js";
import {
  atomicWriteJson,
  readJsonFile,
} from "../../infrastructure/storage-bootstrap/index.js";

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
  project?: ProjectOverlayContext,
): Promise<PermissionOverlayDocument> {
  if (origin === "project") {
    const active = projectContext(path, project);
    const loaded = await active.migrations.load(
      active.context,
      projectPermissionsConfiguration,
    );
    if (
      loaded.classification === "corrupted" ||
      loaded.classification === "incompatible"
    )
      throw new Error(
        "Invalid or incompatible project permissions; tool execution is blocked",
      );
    return projectPermissionValue(loaded.value);
  }
  return readJsonFile(path, permissionOverlayDocumentForOriginSchema(origin), {
    missing: emptyOverlayDocument,
  });
}

const writes = new KeyedSerialQueue<string>();

/** Serializes read-modify-write cycles per file and validates before the atomic write. */
export async function mutatePermissionOverlay(
  origin: PermissionOverlayOrigin,
  path: string,
  mutate: (document: PermissionOverlayDocument) => void,
  project?: ProjectOverlayContext,
  /** The user's overlay stays trusted when Nerve writes it (docs/architecture/trust.md). */
  userTrust?: TrustStorage,
): Promise<void> {
  if (origin === "project") {
    const active = projectContext(path, project);
    return active.migrations.transact(
      active.context,
      projectPermissionsConfiguration,
      (document) => {
        mutate(document);
        return { result: undefined, changed: true };
      },
    );
  }
  await writes.run(path, async () => {
    if (origin === "user") {
      assertHomeConfigurationPathWritable(path);
      try {
        await readJsonFile(
          path,
          permissionOverlayDocumentForOriginSchema(origin),
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
    if (origin === "user")
      await trustedWrite(
        userTrust,
        { kind: "permissions", projectId: null, path },
        async () => {
          await atomicWriteJson(path, parsed, 0o600);
          return `${JSON.stringify(parsed, null, 2)}\n`;
        },
      );
    else await atomicWriteJson(path, parsed, 0o600);
  });
}

/**
 * The overlay Nerve itself creates when it first starts holds no rules and was never reviewed, so
 * it is recorded as trusted; any other bytes, or any existing decision, are left alone.
 */
export function trustShippedUserOverlay(
  storage: Pick<CoreStorage, "trustedResources">,
  path: string,
): void {
  if (storage.trustedResources.find("permissions", null, path)) return;
  let bytes: Buffer | undefined;
  try {
    bytes = readFileSync(path);
  } catch {
    return;
  }
  const shipped = `${JSON.stringify(defaultUserConfiguration.permissions, null, 2)}\n`;
  if (bytes.toString("utf8") !== shipped) return;
  const now = new Date().toISOString();
  storage.trustedResources.insert({
    id: createId("trust"),
    kind: "permissions",
    projectId: null,
    resourceKey: path,
    name: null,
    grants: null,
    contentDigest: overlayDigest(bytes),
    status: "trusted",
    createdAt: now,
    updatedAt: now,
  });
}
