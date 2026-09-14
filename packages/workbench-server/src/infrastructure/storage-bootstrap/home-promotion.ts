import { createHash } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  homePromotionMarkerSchema,
  restorePromotionSchema,
  runtimeAdmissionSchema,
  type HomePromotionMarker,
} from "@nervekit/contracts/storage";
import { atomicWriteJson } from "./json.js";
import { canonicalConversationJson } from "../../domains/conversations/timeline/command-fingerprint.js";

export const homePromotionMarkerPath = (home: string) =>
  `${home}.promotion.json`;

export async function requestHomePromotion(input: {
  home: string;
  restoreId: string;
  backupId: string;
  candidateHome: string;
  candidatePromotionDigest: string;
  now?: string;
}): Promise<HomePromotionMarker> {
  const parent = dirname(input.home);
  assertSibling(parent, input.candidateHome);
  const existing = await readMarker(input.home);
  if (existing) throw new Error("A home promotion is already pending.");
  const now = input.now ?? new Date().toISOString();
  const marker = homePromotionMarkerSchema.parse({
    schemaVersion: 1,
    restoreId: input.restoreId,
    backupId: input.backupId,
    liveHomeName: basename(input.home),
    candidateHomeName: basename(input.candidateHome),
    rollbackHomeName: `${basename(input.home)}.rollback-${input.restoreId}`,
    candidatePromotionDigest: input.candidatePromotionDigest,
    state: "requested",
    requestedAt: now,
    updatedAt: now,
  });
  await writeMarker(input.home, marker);
  return marker;
}

/** Runs only while the external startup lock is held and before opening SQLite. */
export async function recoverHomePromotionAtStartup(
  home: string,
): Promise<void> {
  let marker = await readMarker(home);
  if (!marker || marker.state === "verified") return;
  const parent = dirname(home);
  if (marker.liveHomeName !== basename(home)) {
    throw new Error("Home promotion marker targets a different live home.");
  }
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
          await syncPath(parent);
        } else if (!(await exists(rollback))) {
          throw new Error(
            "Neither live nor rollback home exists for promotion.",
          );
        }
        marker = await advance(home, marker, "old_home_renamed");
      }
    }
    if (marker.state === "old_home_renamed") {
      if (await exists(candidate)) {
        if (await exists(home))
          throw new Error(
            "Live and candidate homes both exist after old-home rename.",
          );
        await rename(candidate, home);
        await syncPath(parent);
      } else if (!(await exists(home))) {
        throw new Error("Restore candidate disappeared before promotion.");
      }
      marker = await advance(home, marker, "candidate_promoted");
    }
    if (marker.state === "candidate_promoted") {
      await verifyPromotedHome(home, marker);
      await advance(home, marker, "verified");
    }
  } catch (error) {
    const rollbackExists = await exists(rollback);
    const promotedCandidateExists =
      (await exists(home)) && (await exists(join(home, "promotion.json")));
    if (rollbackExists && (!(await exists(home)) || promotedCandidateExists)) {
      if (promotedCandidateExists) {
        await rename(home, `${candidate}.failed-${Date.now()}`);
      }
      await rename(rollback, home);
      await syncPath(parent);
      await rm(homePromotionMarkerPath(home), { force: true });
      await syncPath(parent);
    }
    throw error;
  }
}

async function verifyPromotedHome(
  home: string,
  marker: HomePromotionMarker,
): Promise<void> {
  const promotionBytes = await readFile(join(home, "promotion.json"));
  const promotionDigest = `sha256:${createHash("sha256").update(promotionBytes).digest("hex")}`;
  if (promotionDigest !== marker.candidatePromotionDigest) {
    throw new Error("Promoted restore evidence digest changed.");
  }
  const promotion = restorePromotionSchema.parse(
    JSON.parse(promotionBytes.toString("utf8")),
  );
  if (
    promotion.restoreId !== marker.restoreId ||
    promotion.backupId !== marker.backupId
  ) {
    throw new Error("Promoted restore evidence identity changed.");
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
    if (admission.restoreId !== marker.restoreId)
      throw new Error("Promoted runtime admission identity changed.");
  } finally {
    database.close();
  }
}

async function readMarker(
  home: string,
): Promise<HomePromotionMarker | undefined> {
  try {
    return homePromotionMarkerSchema.parse(
      JSON.parse(await readFile(homePromotionMarkerPath(home), "utf8")),
    );
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
  await syncPath(dirname(home));
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
  ) {
    throw new Error("Restore candidate must be a sibling of the live home.");
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function syncPath(path: string): Promise<void> {
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
