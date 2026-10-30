import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createId } from "@nervekit/contracts";
import { isDeepStrictEqual } from "node:util";
import type { CoreStorage } from "@nervekit/conversation-core";
import type { TrustedResourceKind } from "@nervekit/contracts/core";
import type { ProjectMigrationTrust } from "./project-migration.js";

const digest = (bytes: Buffer) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
/** Uses existing byte-bound trust records; no new storage or implicit approval. */
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
    async capture({ type, projectId, path, source, targetKind, sources }) {
      const storage = getStorage();
      const kind = targetKind ?? kinds[type] ?? kinds[type.split(":")[0]];
      if (!kind) return undefined;
      const inputs = sources?.length
        ? sources.filter((input) => input.kind)
        : [{ path, source, kind }];
      if (!inputs.length) return undefined;
      const approvals = inputs.map((input) => ({
        ...input,
        before: storage.trustedResources.find(
          input.kind!,
          projectId,
          input.path,
        ),
      }));
      if (
        approvals.some(
          (input) =>
            input.before?.status !== "trusted" ||
            input.before.contentDigest.replace(/^sha256:/, "") !==
              digest(input.source).slice("sha256:".length),
        )
      )
        return undefined;
      return async (targetPath, targetBytes) => {
        if (!(await readFile(targetPath)).equals(targetBytes)) return;
        for (const input of approvals)
          if (
            !(await readFile(input.path)).equals(
              input.path === targetPath ? targetBytes : input.source,
            )
          )
            return;
        storage.transaction(() => {
          if (
            approvals.some(
              (input) =>
                !isDeepStrictEqual(
                  storage.trustedResources.find(
                    input.kind!,
                    projectId,
                    input.path,
                  ),
                  input.before,
                ),
            )
          )
            return;
          const existing = storage.trustedResources.find(
            kind,
            projectId,
            targetPath,
          );
          if (
            existing &&
            !approvals.some((input) => input.before?.id === existing.id)
          )
            return;
          const now = new Date().toISOString();
          const outputDigest =
            kind === "project_permissions"
              ? digest(targetBytes)
              : digest(targetBytes).slice("sha256:".length);
          if (!sources && !existing) {
            storage.trustedResources.update(approvals[0].before!.id, {
              path: targetPath,
              name: basename(targetPath),
              contentDigest: outputDigest,
              updatedAt: now,
            });
            return;
          }
          if (existing)
            storage.trustedResources.update(existing.id, {
              contentDigest: outputDigest,
              updatedAt: now,
            });
          else
            storage.trustedResources.insert({
              id: createId("trust"),
              kind,
              projectId,
              path: targetPath,
              name: basename(targetPath),
              contentDigest: outputDigest,
              status: "trusted",
              createdAt: now,
              updatedAt: now,
            });
        });
      };
    },
  };
}
