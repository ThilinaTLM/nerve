import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { WaitGroup } from "@nervekit/contracts/runs";
import { waitGroupSchema } from "@nervekit/contracts/runs";
import {
  assertWaitGroupMemberTransition,
  effectiveWaitGroupState,
} from "../../../domains/runs/runtime/wait-group-state.js";
import { encode } from "./payload-codecs.js";

export function persistTimelineWaitGroup(
  database: DatabaseSync,
  group: WaitGroup,
  now: string,
): void {
  if (effectiveWaitGroupState(group) !== group.state) {
    throw new Error("Wait-group state does not match its member dispositions.");
  }
  const ownership = database
    .prepare(
      `SELECT run_controls.conversation_id AS run_conversation_id,
              conversation_entries.conversation_id AS entry_conversation_id
       FROM run_controls
       LEFT JOIN conversation_entries
         ON conversation_entries.entry_id = ?
       WHERE run_controls.run_id = ?`,
    )
    .get(group.continuationEntryId, group.runId) as
    | { run_conversation_id: string; entry_conversation_id: string | null }
    | undefined;
  if (
    !ownership ||
    (group.continuationEntryId !== null &&
      ownership.entry_conversation_id !== ownership.run_conversation_id)
  ) {
    throw new Error("Wait-group continuation must belong to its owning run.");
  }
  const existing = database
    .prepare(
      `SELECT membership_manifest_id, revision FROM wait_groups
       WHERE wait_group_id = ?`,
    )
    .get(group.waitGroupId) as
    | { membership_manifest_id: string; revision: number }
    | undefined;
  if (existing) {
    updateWaitGroup(database, group, existing);
    return;
  }
  const manifestData = encode({
    version: 1,
    members: group.members.map((member) => ({
      memberId: member.memberId,
      memberKind: member.memberKind,
      ownerId: member.ownerId,
      inputFingerprint: member.inputFingerprint,
      policyFingerprint: member.policyFingerprint,
    })),
  });
  const manifestDigest = `sha256:${createHash("sha256")
    .update(manifestData)
    .digest("hex")}`;
  database
    .prepare(
      `INSERT INTO artifact_manifests (
         manifest_id, schema_version, digest, byte_length, data, created_at_ms
       ) VALUES (?, 1, ?, ?, ?, ?)`,
    )
    .run(
      group.membershipManifestId,
      manifestDigest,
      manifestData.byteLength,
      manifestData,
      Date.parse(now),
    );
  database
    .prepare(
      `INSERT INTO wait_groups (
         wait_group_id, run_id, membership_manifest_id,
         continuation_entry_id, continuation_consumed, effective_state,
         revision
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      group.waitGroupId,
      group.runId,
      group.membershipManifestId,
      group.continuationEntryId,
      group.continuationConsumed ? 1 : 0,
      group.state,
      group.revision,
    );
  const insertMember = database.prepare(
    `INSERT INTO wait_group_members (
       member_id, wait_group_id, member_kind, owner_id, input_fingerprint,
       policy_fingerprint, execution_state, attachment_disposition,
       result_entry_id, non_dispatch_evidence_id, barrier_contribution,
       revision
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const member of group.members) {
    insertMember.run(
      member.memberId,
      member.waitGroupId,
      member.memberKind,
      member.ownerId,
      member.inputFingerprint,
      member.policyFingerprint ?? null,
      member.executionState,
      member.attachmentDisposition,
      member.resultEntryId ?? null,
      member.nonDispatchEvidenceId ?? null,
      member.contributesToBarrier ? 1 : 0,
      member.revision,
    );
  }
}

function updateWaitGroup(
  database: DatabaseSync,
  group: WaitGroup,
  existing: { membership_manifest_id: string; revision: number },
): void {
  if (
    existing.membership_manifest_id !== group.membershipManifestId ||
    group.revision !== existing.revision + 1
  ) {
    throw new Error("Wait-group membership or revision conflict.");
  }
  const rows = database
    .prepare(
      `SELECT member_id, wait_group_id, member_kind, owner_id,
              input_fingerprint, policy_fingerprint, execution_state,
              attachment_disposition, result_entry_id,
              non_dispatch_evidence_id, barrier_contribution, revision
       FROM wait_group_members WHERE wait_group_id = ? ORDER BY member_id`,
    )
    .all(group.waitGroupId) as unknown as MemberRow[];
  if (rows.length !== group.members.length) {
    throw new Error("Wait-group membership is immutable.");
  }
  const updateMember = database.prepare(
    `UPDATE wait_group_members SET
       execution_state = ?, attachment_disposition = ?,
       result_entry_id = ?, non_dispatch_evidence_id = ?,
       barrier_contribution = ?, revision = ?
     WHERE member_id = ? AND revision = ?`,
  );
  for (const next of group.members) {
    const row = rows.find((candidate) => candidate.member_id === next.memberId);
    if (!row) throw new Error("Wait-group membership is immutable.");
    const current = waitGroupSchema.shape.members.element.parse({
      schemaVersion: 1,
      memberId: row.member_id,
      waitGroupId: row.wait_group_id,
      memberKind: row.member_kind,
      ownerId: row.owner_id,
      inputFingerprint: row.input_fingerprint,
      policyFingerprint: row.policy_fingerprint ?? undefined,
      executionState: row.execution_state,
      attachmentDisposition: row.attachment_disposition,
      resultEntryId: row.result_entry_id ?? undefined,
      nonDispatchEvidenceId: row.non_dispatch_evidence_id ?? undefined,
      contributesToBarrier: row.barrier_contribution === 1,
      revision: row.revision,
    });
    assertWaitGroupMemberTransition(current, next);
    if (next.revision === current.revision) continue;
    const changed = updateMember.run(
      next.executionState,
      next.attachmentDisposition,
      next.resultEntryId ?? null,
      next.nonDispatchEvidenceId ?? null,
      next.contributesToBarrier ? 1 : 0,
      next.revision,
      next.memberId,
      current.revision,
    );
    if (changed.changes !== 1) {
      throw new Error(`Wait-group member ${next.memberId} revision conflict.`);
    }
  }
  const changed = database
    .prepare(
      `UPDATE wait_groups SET continuation_entry_id = ?,
         continuation_consumed = ?, effective_state = ?, revision = ?
       WHERE wait_group_id = ? AND revision = ?`,
    )
    .run(
      group.continuationEntryId,
      group.continuationConsumed ? 1 : 0,
      group.state,
      group.revision,
      group.waitGroupId,
      existing.revision,
    );
  if (changed.changes !== 1) throw new Error("Wait-group revision conflict.");
}

interface MemberRow {
  member_id: string;
  wait_group_id: string;
  member_kind: "tool" | "interaction" | "child_agent";
  owner_id: string;
  input_fingerprint: string;
  policy_fingerprint: string | null;
  execution_state: WaitGroup["members"][number]["executionState"];
  attachment_disposition: WaitGroup["members"][number]["attachmentDisposition"];
  result_entry_id: string | null;
  non_dispatch_evidence_id: string | null;
  barrier_contribution: number;
  revision: number;
}
