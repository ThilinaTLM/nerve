import { isDeepStrictEqual } from "node:util";
import assert from "node:assert/strict";
import { basename } from "node:path";
import type { CoreStorage } from "@nervekit/conversation-core";
import { sha256 } from "./released-format.js";
import { type OriginalTrust, type convertedTrust } from "./released-export.js";
export const trustTargetId = (target: ReturnType<typeof convertedTrust>) =>
  `trust_${sha256(`${target.projectId}|${target.kind}|${target.path}`)}`;

export function commitProjectTrust(
  storage: Pick<CoreStorage, "transaction" | "trustedResources">,
  projectId: string,
  originals: OriginalTrust[],
  targets: ReturnType<typeof convertedTrust>[],
  createdAt: string,
): void {
  storage.transaction(() => {
    const desired = targets.map((target) => ({
      id: trustTargetId(target),
      kind: target.kind,
      projectId,
      path: target.path,
      name: basename(target.path),
      contentDigest: target.contentDigest,
      status: target.status,
      createdAt:
        originals.find((source) => target.sourceIds.includes(source.id!))
          ?.createdAt ?? createdAt,
      updatedAt: createdAt,
    }));
    const consumed = new Set(targets.flatMap((target) => target.sourceIds));
    const candidateComplete = desired.every((target) => {
      const current = storage.trustedResources.get(target.id);
      return current && isDeepStrictEqual(current, target);
    });
    for (const binding of targets.flatMap((target) => target.sourceBindings)) {
      const before = originals.find(
        (source) =>
          source.kind === binding.kind &&
          source.path === binding.path &&
          source.projectId === projectId,
      );
      const current = storage.trustedResources.find(
        binding.kind as
          | "agent_profile"
          | "project_capabilities"
          | "project_permissions",
        projectId,
        binding.path,
      );
      assert(
        (before && current && isDeepStrictEqual(before, current)) ||
          (before &&
            candidateComplete &&
            consumed.has(before.id!) &&
            (!current ||
              desired.some((target) => isDeepStrictEqual(current, target)))) ||
          (!before && !current),
        "Project trust source changed during conversion",
      );
    }
    if (
      candidateComplete &&
      [...consumed].every((id) => !storage.trustedResources.get(id))
    )
      return;
    for (const source of originals.filter((source) =>
      consumed.has(source.id!),
    )) {
      const current = storage.trustedResources.get(source.id!);
      assert(
        current &&
          current.contentDigest === source.contentDigest &&
          current.status === source.status &&
          current.path === source.path &&
          current.kind === source.kind &&
          current.projectId === projectId,
        "Project trust source changed during conversion",
      );
    }
    for (const target of desired) {
      const current = storage.trustedResources.find(
        target.kind,
        projectId,
        target.path,
      );
      assert(
        !current || consumed.has(current.id),
        "Project trust target collision",
      );
    }
    for (const id of consumed) storage.trustedResources.delete(id);
    for (const target of desired) storage.trustedResources.insert(target);
  });
}
