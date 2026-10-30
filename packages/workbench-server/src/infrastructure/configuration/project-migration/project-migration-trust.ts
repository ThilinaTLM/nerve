import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import type { CoreStorage } from "@nervekit/conversation-core";
import type { TrustedResourceKind } from "@nervekit/contracts/core";
import type { ProjectMigrationTrust } from "./project-migration.js";

const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
/** Preserve an existing exact-byte approval for a same-file bump only. */
export function projectMigrationTrust(
  getStorage: () => Pick<CoreStorage, "trustedResources" | "transaction">,
  kinds: Readonly<Record<string, TrustedResourceKind>>,
): ProjectMigrationTrust {
  return {
    async revoke({ type, projectId, paths }) {
      const storage = getStorage();
      const kind = kinds[type] ?? kinds[type.split(":")[0]];
      if (!kind) return;
      storage.transaction(() => {
        for (const path of paths) {
          const record = storage.trustedResources.find(kind, projectId, path);
          if (record) storage.trustedResources.delete(record.id);
        }
      });
    },
    async capture({ type, projectId, path, source }) {
      const storage = getStorage();
      const kind = kinds[type] ?? kinds[type.split(":")[0]];
      if (!kind) return undefined;
      const before = storage.trustedResources.find(kind, projectId, path);
      if (
        before?.status !== "trusted" ||
        before.contentDigest.replace(/^sha256:/, "") !== digest(source)
      )
        return undefined;
      return async (targetPath, output) => {
        if (targetPath !== path || !(await readFile(path)).equals(output))
          return;
        storage.transaction(() => {
          if (
            !isDeepStrictEqual(
              storage.trustedResources.find(kind, projectId, path),
              before,
            )
          )
            return;
          storage.trustedResources.update(before.id, {
            contentDigest: `${kind === "project_permissions" ? "sha256:" : ""}${digest(output)}`,
            updatedAt: new Date().toISOString(),
          });
        });
      };
    },
  };
}
