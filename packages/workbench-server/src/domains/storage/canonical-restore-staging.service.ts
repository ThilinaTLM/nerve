import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  restorePromotionSchema,
  type RestorePromotion,
} from "@nervekit/contracts/storage";
import type { StoragePaths } from "../../infrastructure/storage-bootstrap/index.js";
import { CanonicalDatabase } from "../../infrastructure/persistence/canonical-sqlite/canonical-database.js";
import {
  decode,
  encode,
} from "../../infrastructure/persistence/canonical-sqlite/payload-codecs.js";
import { canonicalConversationJson } from "../conversations/timeline/command-fingerprint.js";
import { CanonicalBackupVerifier } from "./canonical-backup-verifier.js";
import {
  promotionEvidenceDigest,
  requestHomePromotion,
} from "../../infrastructure/storage-bootstrap/home-promotion.js";

/** Builds an isolated, non-dispatching restore candidate without replacing live state. */
export class CanonicalRestoreStagingService {
  private readonly verifier = new CanonicalBackupVerifier();

  constructor(private readonly paths: StoragePaths) {}

  async admit(
    restoreId: string,
    options: { proveIsolation?: boolean } = {},
  ): Promise<RestorePromotion> {
    if (!/^restore_[A-Za-z0-9-]+$/.test(restoreId)) {
      throw new Error("Restore ID is invalid.");
    }
    const database = new DatabaseSync(
      join(
        dirname(this.paths.home),
        `${basename(this.paths.home)}.candidate-${restoreId}`,
        "data",
        "nerve.sqlite",
      ),
    );
    try {
      database.exec("BEGIN IMMEDIATE");
      const row = database
        .prepare(`SELECT data FROM restore_promotions WHERE restore_id = ?`)
        .get(restoreId) as { data: Uint8Array } | undefined;
      const current = row
        ? restorePromotionSchema.parse(decode(row.data))
        : undefined;
      if (!current) throw new Error("Restore promotion does not exist.");
      if (
        current.oldRuntimeIsolation !== "proven" &&
        options.proveIsolation !== true
      ) {
        throw new Error(
          "Restore dispatch cannot be admitted without proven isolation.",
        );
      }
      const admitted = restorePromotionSchema.parse({
        ...current,
        oldRuntimeIsolation: "proven",
        dispatchState: "admitted",
      });
      database
        .prepare(
          `UPDATE restore_promotions SET dispatch_state = 'admitted',
               old_runtime_isolation = 'proven', data = ?
           WHERE restore_id = ?`,
        )
        .run(encode(admitted), restoreId);
      database
        .prepare(
          `UPDATE runtime_admission SET dispatch_state = 'admitted',
               updated_at_ms = ? WHERE singleton = 1 AND restore_id = ?`,
        )
        .run(Date.now(), restoreId);
      database.exec("COMMIT");
      const candidate = join(
        dirname(this.paths.home),
        `${basename(this.paths.home)}.candidate-${restoreId}`,
      );
      await writeFile(
        join(candidate, "promotion.json"),
        canonicalConversationJson(admitted),
        { mode: 0o600 },
      );
      await syncPath(join(candidate, "promotion.json"));
      await syncPath(candidate);
      return admitted;
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // The transaction did not begin or was already rolled back.
      }
      throw error;
    } finally {
      database.close();
    }
  }

  async stage(input: {
    backupId: string;
    oldRuntimeIsolation: "proven" | "unproven";
    now?: string;
  }): Promise<{ promotion: RestorePromotion; restorePath: string }> {
    if (!/^backup_[A-Za-z0-9-]+$/.test(input.backupId)) {
      throw new Error("Backup ID is invalid.");
    }
    const verified = await this.verifier.verifyBundle(
      join(this.paths.backupsPath, input.backupId),
    );
    const restoreId = `restore_${randomUUID()}`;
    const parent = dirname(this.paths.home);
    const staging = join(
      parent,
      `.${basename(this.paths.home)}.${restoreId}.staging`,
    );
    const destination = join(
      parent,
      `${basename(this.paths.home)}.candidate-${restoreId}`,
    );
    const now = input.now ?? new Date().toISOString();
    await mkdir(staging, { recursive: false, mode: 0o700 });
    try {
      const databaseEntry = verified.entries.find(
        (entry) => entry.kind === "database",
      );
      if (!databaseEntry) throw new Error("Verified backup has no database.");
      await copyRuntimeShell(this.paths.home, staging);
      const databasePath = join(staging, "data", "nerve.sqlite");
      await copyBytes(
        join(verified.root, databaseEntry.relativeLocator),
        databasePath,
      );
      for (const entry of verified.entries) {
        if (entry.kind === "artifact") {
          const prefix = "artifacts/";
          if (!entry.relativeLocator.startsWith(prefix)) {
            throw new Error("Backup artifact locator is not portable.");
          }
          await copyBytes(
            join(verified.root, entry.relativeLocator),
            join(staging, entry.relativeLocator.slice(prefix.length)),
          );
        } else if (entry.kind === "permission_file") {
          await copyBytes(
            join(verified.root, entry.relativeLocator),
            join(staging, "config", "permissions.json"),
          );
        }
      }

      const migrated = new CanonicalDatabase(databasePath);
      migrated.initialize();
      migrated.close();
      const promotion = quarantineDatabase({
        databasePath,
        restoreId,
        backupId: verified.manifest.backupId,
        namespaceId: verified.manifest.namespaceId,
        priorIncarnationId: verified.manifest.sourceExecutionIncarnationId,
        oldRuntimeIsolation: input.oldRuntimeIsolation,
        now,
      });
      await writeFile(
        join(staging, "promotion.json"),
        canonicalConversationJson(promotion),
        { mode: 0o600 },
      );
      await syncPath(databasePath);
      await syncPath(join(staging, "promotion.json"));
      await syncPath(staging);
      await rename(staging, destination);
      await syncPath(parent);
      return { promotion, restorePath: destination };
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  async status(restoreId: string): Promise<RestorePromotion> {
    return restorePromotionSchema.parse(
      JSON.parse(
        await readFile(
          join(this.candidatePath(restoreId), "promotion.json"),
          "utf8",
        ),
      ),
    );
  }

  async requestPromotionById(restoreId: string) {
    const promotion = await this.admit(restoreId, { proveIsolation: true });
    return this.requestPromotion({
      promotion,
      restorePath: this.candidatePath(restoreId),
    });
  }

  async requestPromotion(input: {
    promotion: RestorePromotion;
    restorePath: string;
    now?: string;
  }) {
    return requestHomePromotion({
      home: this.paths.home,
      restoreId: input.promotion.restoreId,
      backupId: input.promotion.backupId,
      candidateHome: input.restorePath,
      candidatePromotionDigest: promotionEvidenceDigest(input.promotion),
      now: input.now,
    });
  }

  private candidatePath(restoreId: string): string {
    if (!/^restore_[A-Za-z0-9-]+$/.test(restoreId)) {
      throw new Error("Restore ID is invalid.");
    }
    return join(
      dirname(this.paths.home),
      `${basename(this.paths.home)}.candidate-${restoreId}`,
    );
  }
}

async function copyRuntimeShell(home: string, staging: string): Promise<void> {
  await mkdir(join(staging, "data"), { recursive: true, mode: 0o700 });
  for (const relative of [
    "manifest.json",
    "config",
    "secrets",
    "daemon.json",
    "tls",
    "migrations",
  ]) {
    const source = join(home, relative);
    try {
      await cp(source, join(staging, relative), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function quarantineDatabase(input: {
  databasePath: string;
  restoreId: string;
  backupId: string;
  namespaceId: string;
  priorIncarnationId: string;
  oldRuntimeIsolation: "proven" | "unproven";
  now: string;
}): RestorePromotion {
  const database = new DatabaseSync(input.databasePath);
  const promotedIncarnationId = `incarnation_${randomUUID()}`;
  const dispatchState =
    input.oldRuntimeIsolation === "proven" ? "quarantined" : "disabled";
  try {
    database.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    const identity = database
      .prepare(
        `SELECT namespace_id, execution_incarnation_id
         FROM state_identity WHERE singleton = 1`,
      )
      .get() as
      | { namespace_id: string; execution_incarnation_id: string }
      | undefined;
    if (
      !identity ||
      identity.namespace_id !== input.namespaceId ||
      identity.execution_incarnation_id !== input.priorIncarnationId
    ) {
      throw new Error("Restore source identity changed during staging.");
    }
    const quarantinedRunCount = Number(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM run_controls
             WHERE effective_state NOT IN (
               'completed','failed','cancelled','abandoned','superseded',
               'deletion_fenced'
             )`,
          )
          .get() as { count: number }
      ).count,
    );
    const quarantineEvidence = {
      schemaVersion: 1,
      restoreId: input.restoreId,
      backupId: input.backupId,
      priorIncarnationId: input.priorIncarnationId,
      promotedIncarnationId,
      quarantinedRunCount,
      policy: "conservative-restore-quarantine-v1",
    };
    const quarantineManifestDigest = digestJson(quarantineEvidence);
    const promotion = restorePromotionSchema.parse({
      schemaVersion: 1,
      restoreId: input.restoreId,
      backupId: input.backupId,
      namespaceId: input.namespaceId,
      priorExecutionIncarnationId: input.priorIncarnationId,
      promotedExecutionIncarnationId: promotedIncarnationId,
      oldRuntimeIsolation: input.oldRuntimeIsolation,
      dispatchState,
      quarantinedRunCount,
      quarantineManifestDigest,
      promotedAt: input.now,
    });
    const timestamp = Date.parse(input.now);
    database
      .prepare(
        `UPDATE execution_claims SET state = 'revoked' WHERE state = 'active'`,
      )
      .run();
    database
      .prepare(
        `UPDATE execution_attempts
         SET state = 'outcome_unknown', updated_at_ms = ?
         WHERE state IN ('ready','claimed','dispatched')`,
      )
      .run(timestamp);
    database
      .prepare(
        `UPDATE logical_effects SET state = 'outcome_unknown'
         WHERE state IN ('authorized','dispatching')`,
      )
      .run();
    database
      .prepare(
        `UPDATE exact_call_authorizations SET state = 'revoked'
         WHERE state = 'active'`,
      )
      .run();
    database
      .prepare(
        `UPDATE provider_phases
         SET state = 'recovery_required', recovery_admission_id = NULL,
             updated_at_ms = ?
         WHERE state NOT IN ('succeeded','known_failed','cancelled','closed')`,
      )
      .run(timestamp);
    database
      .prepare(
        `UPDATE wait_groups SET effective_state = 'recovery_required',
             continuation_consumed = 1, revision = revision + 1
         WHERE effective_state IN ('open','ready')`,
      )
      .run();
    database
      .prepare(
        `UPDATE run_controls SET effective_state = 'recovery_required',
             foreground_owned = 0, provider_phase_id = NULL,
             wait_group_id = NULL, recovery_reason = 'restore_quarantine',
             revision = revision + 1, updated_at_ms = ?
         WHERE effective_state NOT IN (
           'completed','failed','cancelled','abandoned','superseded',
           'deletion_fenced'
         )`,
      )
      .run(timestamp);
    database
      .prepare(
        `UPDATE artifact_preparations SET lease_state = 'expired'
         WHERE lease_state = 'active'`,
      )
      .run();
    database
      .prepare(
        `UPDATE state_identity SET execution_incarnation_id = ?,
             promoted_at_ms = ? WHERE singleton = 1`,
      )
      .run(promotedIncarnationId, timestamp);
    database
      .prepare(
        `INSERT INTO restore_promotions (
           restore_id, backup_id, namespace_id,
           prior_execution_incarnation_id,
           promoted_execution_incarnation_id, old_runtime_isolation,
           dispatch_state, quarantined_run_count,
           quarantine_manifest_digest, data, promoted_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        promotion.restoreId,
        promotion.backupId,
        promotion.namespaceId,
        promotion.priorExecutionIncarnationId,
        promotion.promotedExecutionIncarnationId,
        promotion.oldRuntimeIsolation,
        promotion.dispatchState,
        promotion.quarantinedRunCount,
        promotion.quarantineManifestDigest,
        encode(promotion),
        timestamp,
      );
    database
      .prepare(
        `UPDATE runtime_admission SET execution_incarnation_id = ?,
             dispatch_state = ?, restore_id = ?, updated_at_ms = ?
         WHERE singleton = 1`,
      )
      .run(
        promotedIncarnationId,
        dispatchState,
        promotion.restoreId,
        timestamp,
      );
    database.exec("COMMIT");
    return promotion;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The transaction may already have been rolled back.
    }
    throw error;
  } finally {
    database.close();
  }
}

async function copyBytes(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await copyFile(source, target);
  await syncPath(target);
}

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP") throw error;
  } finally {
    await handle.close();
  }
}

function digestJson(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalConversationJson(value))
    .digest("hex")}`;
}
