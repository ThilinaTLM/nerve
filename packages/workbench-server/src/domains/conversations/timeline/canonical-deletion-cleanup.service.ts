import { createHash } from "node:crypto";
import { lstat, readFile, unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { DeletionIntent } from "@nervekit/contracts/storage";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { StoragePaths } from "../../../infrastructure/storage-bootstrap/index.js";

/** Advances one bounded deletion unit; artifact IO occurs between transactions. */
export class CanonicalDeletionCleanupService {
  constructor(
    private readonly store: CanonicalStore,
    private readonly paths: StoragePaths,
  ) {}

  async advance(input: {
    conversationId: string;
    limit?: number;
    now?: string;
  }): Promise<DeletionIntent> {
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError("Deletion cleanup limit must be between 1 and 500.");
    }
    const now = input.now ?? new Date().toISOString();
    const intent = await this.store.deletion.readIntent(input.conversationId);
    if (!intent) {
      throw new Error(
        `Deletion intent for '${input.conversationId}' was not found.`,
      );
    }
    if (intent.phase === "fenced" || intent.phase === "settling_execution") {
      return this.store.deletion.settleExecution(input.conversationId, now);
    }
    if (
      intent.phase === "removing_history" ||
      intent.phase === "retaining_replay_evidence"
    ) {
      return this.store.deletion.removeHistory(
        input.conversationId,
        limit,
        now,
      );
    }
    if (intent.phase !== "removing_payloads") return intent;

    const work = await this.store.deletion.claimArtifacts(
      input.conversationId,
      limit,
      now,
    );
    if (work.length > 0) {
      for (const item of work) {
        try {
          const state = await this.removeArtifact(item);
          await this.store.deletion.settleArtifact(
            item.workId,
            state,
            undefined,
            now,
          );
        } catch (error) {
          await this.store.deletion.settleArtifact(
            item.workId,
            "failed",
            error instanceof Error ? error.message : String(error),
            now,
          );
        }
      }
      return (
        (await this.store.deletion.readIntent(input.conversationId)) ?? intent
      );
    }
    return this.store.deletion.redactPayloads(input.conversationId, limit, now);
  }

  private async removeArtifact(input: {
    relativeLocator: string;
    expectedDigest: string;
    expectedByteLength: number;
  }): Promise<"deleted" | "missing"> {
    const path = resolve(this.paths.home, input.relativeLocator);
    const root = resolve(this.paths.home);
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      throw new Error("Artifact deletion locator escapes storage home.");
    }
    let stats;
    try {
      stats = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
      throw error;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(
        "Artifact deletion target is not a managed regular file.",
      );
    }
    const bytes = await readFile(path);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (
      bytes.byteLength !== input.expectedByteLength ||
      digest !== input.expectedDigest
    ) {
      throw new Error("Artifact deletion target does not match its manifest.");
    }
    await unlink(path);
    return "deleted";
  }
}
