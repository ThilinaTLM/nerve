import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PermissionOverlayOrigin } from "@nervekit/contracts/permissions";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import {
  atomicWriteJson,
  managedOwnerPathSegment,
} from "../../infrastructure/storage-bootstrap/index.js";

const emptyOverlay = { schemaVersion: 2 as const, overlays: [] };

/** Conflict-safe explicit repair for file-authoritative permission overlays. */
export class PermissionOverlayRepairService {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly deps: {
      storage: InitializedStorage;
      getProject(projectId: string): ProjectRecord;
      trustProject(projectId: string): Promise<unknown>;
    },
  ) {}

  async reset(input: {
    origin: PermissionOverlayOrigin;
    ownerId?: string;
    expectedDocumentDigest: string;
    quarantine: boolean;
  }): Promise<
    | { kind: "reset"; documentIdentity: string; quarantineIdentity?: string }
    | { kind: "external_conflict"; currentDocumentDigest?: string }
  > {
    const path = this.overlayPath(input.origin, input.ownerId);
    return this.exclusive(path, async () => {
      let content: string;
      try {
        content = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { kind: "external_conflict" as const };
        }
        throw error;
      }
      const currentDocumentDigest = digest(content);
      if (currentDocumentDigest !== input.expectedDocumentDigest) {
        return { kind: "external_conflict" as const, currentDocumentDigest };
      }
      let quarantineIdentity: string | undefined;
      if (input.quarantine) {
        const quarantineDir = join(
          this.deps.storage.paths.home,
          "quarantine",
          "permission-overlays",
        );
        await mkdir(quarantineDir, { recursive: true, mode: 0o700 });
        quarantineIdentity = `${input.origin}-${currentDocumentDigest.slice(7, 23)}.json`;
        await copyFile(path, join(quarantineDir, quarantineIdentity));
      }
      await atomicWriteJson(path, emptyOverlay, 0o600);
      if (input.origin === "project") {
        if (!input.ownerId) throw new Error("Project ID is required.");
        await this.deps.trustProject(input.ownerId);
      }
      return {
        kind: "reset" as const,
        documentIdentity: `${input.origin}:permissions.json`,
        ...(quarantineIdentity ? { quarantineIdentity } : {}),
      };
    });
  }

  private overlayPath(
    origin: PermissionOverlayOrigin,
    ownerId?: string,
  ): string {
    if (origin === "user") return this.deps.storage.paths.permissionsConfigPath;
    if (!ownerId) throw new Error(`${origin} overlay owner ID is required.`);
    if (origin === "project") {
      return join(
        this.deps.getProject(ownerId).dir,
        ".nerve",
        "config",
        "permissions.json",
      );
    }
    return join(
      this.deps.storage.paths.conversationsPath,
      managedOwnerPathSegment(ownerId, "conv_"),
      "permissions.json",
    );
  }

  private async exclusive<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, tail);
    return result.finally(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
  }
}

function digest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
