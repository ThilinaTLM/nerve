import { DatabaseSync } from "node:sqlite";
import {
  lifecycleWorkSchema,
  recoveryIssueSchema,
  type LifecycleWork,
  type RecoveryIssue,
} from "@nervekit/contracts/runs";
import { decode, encode } from "./payload-codecs.js";

export interface FenceCancelledRunToolWorkInput {
  runId: string;
  now: string;
  /** Proposal ids whose terminal tool record proves a claim without a result. */
  unknownProposalIds: string[];
}

/** Fence ready work and persist post-claim inspection issues in one transaction. */
export function fenceCancelledRunToolWorkInTransaction(
  database: DatabaseSync,
  input: FenceCancelledRunToolWorkInput,
  work: LifecycleWork[],
): LifecycleWork[] {
  const uncertain = new Set(input.unknownProposalIds);
  const fenced: LifecycleWork[] = [];
  for (const current of work) {
    if (current.kind !== "execute_tool") continue;
    if (current.state === "ready") {
      const mayHaveRun = Boolean(
        current.proposalId && uncertain.has(current.proposalId),
      );
      const next = lifecycleWorkSchema.parse({
        ...current,
        state: mayHaveRun ? "outcome_unknown" : "cancelled",
        lastError: mayHaveRun
          ? "Run cancelled after this tool may have started; inspect the target."
          : "Run cancelled before tool work was claimed.",
        failurePhase: mayHaveRun ? "post_dispatch" : "pre_dispatch",
        updatedAt: input.now,
      });
      const changed = database
        .prepare(
          `UPDATE lifecycle_work SET state = ?, last_error = ?,
         data = ?, updated_at_ms = ? WHERE id = ? AND state = 'ready'
         AND generation = ?`,
        )
        .run(
          next.state,
          next.lastError!,
          encode(next),
          Date.parse(input.now),
          next.id,
          current.generation,
        );
      if (Number(changed.changes) === 1) fenced.push(next);
    }
    if (!current.proposalId || !uncertain.has(current.proposalId)) continue;
    const issueId = `recovery_${current.id.slice("work_".length)}`;
    const existing = database
      .prepare(
        `SELECT data FROM lifecycle_recovery_issues WHERE issue_id = ? AND resolved = 0`,
      )
      .get(issueId) as { data: Uint8Array | string } | undefined;
    const issue: RecoveryIssue = recoveryIssueSchema.parse({
      id: issueId,
      conversationId: current.conversationId,
      runId: input.runId,
      workId: current.id,
      proposalId: current.proposalId,
      code: "outcome_unknown",
      message:
        "Cancellation was requested after this tool may have started. Its external outcome is unknown; inspect the target before retrying.",
      actions: ["inspect"],
      createdAt: existing
        ? recoveryIssueSchema.parse(decode(existing.data)).createdAt
        : input.now,
    });
    database
      .prepare(
        `INSERT INTO lifecycle_recovery_issues (
         issue_id, conversation_id, run_id, work_id, code, resolved,
         payload_version, data, created_at_ms, updated_at_ms
       ) VALUES (?, ?, (SELECT run_id FROM run_lifecycle_records WHERE run_id = ?),
         ?, ?, 0, 1, ?, ?, ?)
       ON CONFLICT(issue_id) DO UPDATE SET
         resolved = 0, data = excluded.data,
         updated_at_ms = excluded.updated_at_ms`,
      )
      .run(
        issue.id,
        issue.conversationId,
        input.runId,
        current.id,
        issue.code,
        encode(issue),
        Date.parse(input.now),
        Date.parse(input.now),
      );
  }
  return fenced;
}
