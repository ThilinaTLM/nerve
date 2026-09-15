import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, normalize, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  homeMigrationReportSchema,
  homePromotionMarkerSchema,
  legacyRestorePromotionMarkerSchema,
  restorePromotionSchema,
  runtimeAdmissionSchema,
  type HomePromotionMarker,
} from "@nervekit/contracts/storage";
import { canonicalConversationJson } from "../../domains/conversations/timeline/command-fingerprint.js";
import { atomicWriteJson } from "./json.js";

export const homePromotionMarkerPath = (home: string) =>
  `${home}.promotion.json`;

export async function requestGenericHomePromotion(input: {
  home: string;
  operationKind: HomePromotionMarker["operationKind"];
  operationId: string;
  candidateEvidenceId: string;
  candidateHome: string;
  candidateEvidenceDigest: string;
  sourceAuthorityId: string;
  verifierKind: HomePromotionMarker["verifierKind"];
  rollbackDisposition: HomePromotionMarker["rollbackDisposition"];
  rollbackHomeName?: string;
  archiveRelativePath?: string;
  now?: string;
}): Promise<HomePromotionMarker> {
  const parent = dirname(input.home);
  assertSibling(parent, input.candidateHome);
  if (await readMarker(input.home))
    throw new Error("A home promotion is already pending.");
  if (!(await exists(input.candidateHome)))
    throw new Error("The requested promotion candidate does not exist.");
  const rollbackHomeName =
    input.rollbackHomeName ??
    `${basename(input.home)}.rollback-${input.operationId}`;
  const rollbackHome = sibling(parent, rollbackHomeName);
  if (await exists(rollbackHome))
    throw new Error("The requested promotion rollback path already exists.");
  const now = input.now ?? new Date().toISOString();
  const marker = homePromotionMarkerSchema.parse({
    schemaVersion: 2,
    operationKind: input.operationKind,
    operationId: input.operationId,
    candidateEvidenceId: input.candidateEvidenceId,
    candidateEvidenceDigest: input.candidateEvidenceDigest,
    sourceAuthorityId: input.sourceAuthorityId,
    verifierKind: input.verifierKind,
    rollbackDisposition: input.rollbackDisposition,
    ...(input.archiveRelativePath
      ? { archiveRelativePath: input.archiveRelativePath }
      : {}),
    liveHomeName: basename(input.home),
    candidateHomeName: basename(input.candidateHome),
    rollbackHomeName,
    state: "requested",
    requestedAt: now,
    updatedAt: now,
  });
  await writeMarker(input.home, marker);
  return marker;
}

export async function requestHomePromotion(input: {
  home: string;
  restoreId: string;
  backupId: string;
  candidateHome: string;
  candidatePromotionDigest: string;
  now?: string;
}): Promise<HomePromotionMarker> {
  return requestGenericHomePromotion({
    home: input.home,
    operationKind: "restore",
    operationId: input.restoreId,
    candidateEvidenceId: input.backupId,
    candidateHome: input.candidateHome,
    candidateEvidenceDigest: input.candidatePromotionDigest,
    sourceAuthorityId: input.backupId,
    verifierKind: "restore_v1",
    rollbackDisposition: "retain_sibling",
    now: input.now,
  });
}

/** Runs only while the external startup lock is held and before opening SQLite. */
export async function recoverHomePromotionAtStartup(
  home: string,
  options: {
    afterPhase?: (state: HomePromotionMarker["state"]) => void | Promise<void>;
  } = {},
): Promise<void> {
  let marker = await readMarker(home);
  if (!marker || marker.state === "verified") return;
  const parent = dirname(home);
  if (marker.liveHomeName !== basename(home))
    throw new Error("Home promotion marker targets a different live home.");
  const candidate = sibling(parent, marker.candidateHomeName);
  const rollback = sibling(parent, marker.rollbackHomeName);
  try {
    if (marker.state === "requested") {
      if ((await exists(home)) && (await exists(rollback))) {
        await verifyPromotedHome(home, marker);
        marker = await advance(home, marker, "candidate_promoted");
      } else {
        if (await exists(home)) {
          await rename(home, rollback);
          await syncPromotionDirectory(parent);
        } else if (!(await exists(rollback))) {
          throw new Error(
            "Neither live nor rollback home exists for promotion.",
          );
        }
        marker = await advance(home, marker, "old_home_renamed");
        await options.afterPhase?.("old_home_renamed");
      }
    }
    if (marker.state === "old_home_renamed") {
      if (await exists(candidate)) {
        if (await exists(home))
          throw new Error(
            "Live and candidate homes both exist after old-home rename.",
          );
        await rename(candidate, home);
        await syncPromotionDirectory(parent);
      } else if (!(await exists(home))) {
        throw new Error("Promotion candidate disappeared before promotion.");
      }
      marker = await advance(home, marker, "candidate_promoted");
      await options.afterPhase?.("candidate_promoted");
    }
    if (marker.state === "candidate_promoted") {
      await verifyPromotedHome(home, marker);
      marker = await advance(home, marker, "home_verified");
      await options.afterPhase?.("home_verified");
    }
    if (marker.state === "home_verified") {
      await admitPromotedHome(home, marker);
      marker = await advance(home, marker, "admitted");
      await options.afterPhase?.("admitted");
    }
    if (marker.state === "admitted") {
      if (marker.rollbackDisposition === "archive_under_live") {
        if (!marker.archiveRelativePath)
          throw new Error("Promotion archive path is missing.");
        const archive = safeArchivePath(home, marker.archiveRelativePath);
        if (await exists(rollback)) {
          if (await exists(archive))
            throw new Error("Promotion archive path already exists.");
          await mkdir(dirname(archive), { recursive: true, mode: 0o700 });
          await rename(rollback, archive);
          await syncPromotionDirectory(dirname(archive));
          await syncPromotionDirectory(parent);
        } else if (!(await exists(archive))) {
          throw new Error("Promotion rollback disappeared before archival.");
        }
      }
      marker = await advance(home, marker, "archived");
      await options.afterPhase?.("archived");
    }
    if (marker.state === "archived") await advance(home, marker, "verified");
  } catch (error) {
    const rollbackExists = await exists(rollback);
    const promotedCandidateExists =
      (await exists(home)) && (await candidateEvidenceExists(home, marker));
    if (rollbackExists && (!(await exists(home)) || promotedCandidateExists)) {
      if (promotedCandidateExists)
        await rename(home, `${candidate}.failed-${Date.now()}`);
      await rename(rollback, home);
      await syncPromotionDirectory(parent);
      await rm(homePromotionMarkerPath(home), { force: true });
      await syncPromotionDirectory(parent);
    }
    throw error;
  }
}

async function verifyPromotedHome(
  home: string,
  marker: HomePromotionMarker,
): Promise<void> {
  const evidencePath =
    marker.verifierKind === "restore_v1"
      ? join(home, "promotion.json")
      : join(home, "migrations", "legacy-v2-import.json");
  const evidenceBytes = await readFile(evidencePath);
  const evidenceDigest = `sha256:${createHash("sha256").update(evidenceBytes).digest("hex")}`;
  if (evidenceDigest !== marker.candidateEvidenceDigest)
    throw new Error("Promoted candidate evidence digest changed.");
  if (marker.verifierKind === "restore_v1") {
    const promotion = restorePromotionSchema.parse(
      JSON.parse(evidenceBytes.toString("utf8")),
    );
    if (
      promotion.restoreId !== marker.operationId ||
      promotion.backupId !== marker.candidateEvidenceId
    ) {
      throw new Error("Promoted restore evidence identity changed.");
    }
  } else {
    const report = homeMigrationReportSchema.parse(
      JSON.parse(evidenceBytes.toString("utf8")),
    );
    if (
      report.sourceVersion !== 2 ||
      marker.candidateEvidenceId !== "legacy-v2-import.json"
    ) {
      throw new Error("Promoted migration evidence identity changed.");
    }
  }
  const database = new DatabaseSync(join(home, "data", "nerve.sqlite"), {
    readOnly: true,
  });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").get() as {
      integrity_check?: string;
    };
    if (integrity.integrity_check !== "ok")
      throw new Error("Promoted SQLite integrity check failed.");
    const row = database
      .prepare(
        "SELECT execution_incarnation_id, dispatch_state, restore_id, updated_at_ms FROM runtime_admission WHERE singleton = 1",
      )
      .get() as
      | {
          execution_incarnation_id: string;
          dispatch_state: string;
          restore_id: string | null;
          updated_at_ms: number;
        }
      | undefined;
    if (!row) throw new Error("Promoted runtime admission is missing.");
    const admission = runtimeAdmissionSchema.parse({
      schemaVersion: 1,
      executionIncarnationId: row.execution_incarnation_id,
      dispatchState: row.dispatch_state,
      ...(row.restore_id ? { restoreId: row.restore_id } : {}),
      updatedAt: new Date(row.updated_at_ms).toISOString(),
    });
    if (
      marker.verifierKind === "restore_v1" &&
      admission.restoreId !== marker.operationId
    ) {
      throw new Error("Promoted runtime admission identity changed.");
    }
    if (marker.verifierKind === "legacy_v2_canonical_v1") {
      if (admission.dispatchState !== "disabled" || admission.restoreId) {
        throw new Error(
          "Migrated candidate was not promoted under dispatch quarantine.",
        );
      }
      const legacyRows = database
        .prepare(
          "SELECT COUNT(*) AS count FROM domain_documents WHERE namespace IN ('conversation_state','conversation_journal_head','conversation_journal_commit')",
        )
        .get() as { count: number };
      if (legacyRows.count !== 0)
        throw new Error(
          "Migrated candidate retains legacy conversation authority.",
        );
    }
  } finally {
    database.close();
  }
}

async function admitPromotedHome(
  home: string,
  marker: HomePromotionMarker,
): Promise<void> {
  if (marker.verifierKind !== "legacy_v2_canonical_v1") return;
  const database = new DatabaseSync(join(home, "data", "nerve.sqlite"));
  try {
    database.exec("BEGIN IMMEDIATE");
    const result = database
      .prepare(
        `UPDATE runtime_admission
            SET dispatch_state = 'admitted', updated_at_ms = ?
          WHERE singleton = 1 AND dispatch_state = 'disabled' AND restore_id IS NULL`,
      )
      .run(Date.now());
    if (Number(result.changes) !== 1) {
      database.exec("ROLLBACK");
      throw new Error("Promoted migration admission fence changed.");
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}

async function candidateEvidenceExists(
  home: string,
  marker: HomePromotionMarker,
): Promise<boolean> {
  const path =
    marker.verifierKind === "restore_v1"
      ? join(home, "promotion.json")
      : join(home, "migrations", "legacy-v2-import.json");
  return exists(path);
}

async function readMarker(
  home: string,
): Promise<HomePromotionMarker | undefined> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(homePromotionMarkerPath(home), "utf8"),
    );
    const current = homePromotionMarkerSchema.safeParse(raw);
    if (current.success) return current.data;
    const legacy = legacyRestorePromotionMarkerSchema.parse(raw);
    return homePromotionMarkerSchema.parse({
      schemaVersion: 2,
      operationKind: "restore",
      operationId: legacy.restoreId,
      candidateEvidenceId: legacy.backupId,
      candidateEvidenceDigest: legacy.candidatePromotionDigest,
      sourceAuthorityId: legacy.backupId,
      verifierKind: "restore_v1",
      rollbackDisposition: "retain_sibling",
      liveHomeName: legacy.liveHomeName,
      candidateHomeName: legacy.candidateHomeName,
      rollbackHomeName: legacy.rollbackHomeName,
      state: legacy.state === "verified" ? "verified" : legacy.state,
      requestedAt: legacy.requestedAt,
      updatedAt: legacy.updatedAt,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function advance(
  home: string,
  marker: HomePromotionMarker,
  state: HomePromotionMarker["state"],
): Promise<HomePromotionMarker> {
  const next = homePromotionMarkerSchema.parse({
    ...marker,
    state,
    updatedAt: new Date().toISOString(),
  });
  await writeMarker(home, next);
  return next;
}

async function writeMarker(
  home: string,
  marker: HomePromotionMarker,
): Promise<void> {
  await atomicWriteJson(homePromotionMarkerPath(home), marker, 0o600);
  await syncPromotionDirectory(dirname(home));
}

function safeArchivePath(home: string, relativePath: string): string {
  const normalized = normalize(relativePath);
  if (
    normalized.startsWith(`..${sep}`) ||
    normalized === ".." ||
    normalized.startsWith(sep)
  ) {
    throw new Error("Promotion archive path escapes the promoted home.");
  }
  return join(home, normalized);
}

function sibling(parent: string, name: string): string {
  if (name !== basename(name) || name === "." || name === "..")
    throw new Error("Promotion marker contains a non-sibling path.");
  return join(parent, name);
}
function assertSibling(parent: string, candidate: string): void {
  if (
    dirname(candidate) !== parent ||
    basename(candidate) !== candidate.slice(parent.length + 1)
  )
    throw new Error("Promotion candidate must be a sibling of the live home.");
}
async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}
export async function syncPromotionDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export function promotionEvidenceDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalConversationJson(value)).digest("hex")}`;
}
