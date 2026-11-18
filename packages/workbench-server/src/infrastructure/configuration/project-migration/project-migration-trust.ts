import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { createId } from "@nervekit/contracts";
import type { CoreStorage } from "@nervekit/conversation-core";
import type { TrustedResourceKind } from "@nervekit/contracts/core";
import type { ProjectMigrationTrust } from "./project-migration.js";

const approval = (bytes: Buffer) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/**
 * Carries an exact-byte approval to bytes Nerve writes to the same file: a
 * trusted original stays trusted, and a file Nerve creates is trusted.
 */
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
      // Prompt suggestion trust binds the predicate, not the file bytes.
      if (!kind || kind === "prompt_suggestion") return undefined;
      const before = storage.trustedResources.find(kind, projectId, path);
      if (
        source !== undefined &&
        (before?.status !== "trusted" ||
          before.contentDigest !== approval(source))
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
          const now = new Date().toISOString();
          if (before)
            storage.trustedResources.update(before.id, {
              contentDigest: approval(output),
              status: "trusted",
              updatedAt: now,
            });
          else
            storage.trustedResources.insert({
              id: createId("trust"),
              kind,
              projectId,
              resourceKey: path,
              name: null,
              grants: null,
              contentDigest: approval(output),
              status: "trusted",
              createdAt: now,
              updatedAt: now,
            });
        });
      };
    },
  };
}
