import type { DatabaseSync } from "node:sqlite";
import type { ProviderPhase, RunControl } from "@nervekit/contracts/runs";
import { providerPhaseSchema } from "@nervekit/contracts/runs";
import { assertProviderPhaseTransition } from "../../../domains/runs/runtime/provider-phase-state.js";
import { decode, encode } from "./payload-codecs.js";

export function persistTimelineProviderPhase(
  database: DatabaseSync,
  phase: ProviderPhase,
  now: string,
): void {
  const existing = readProviderPhase(database, phase.phaseId);
  if (existing) {
    assertProviderPhaseTransition(existing, phase);
    const changed = database
      .prepare(
        `UPDATE provider_phases SET request_manifest_id = ?, request_hash = ?,
           state = ?, committed_response_id = ?, recovery_admission_id = ?,
           updated_at_ms = ?
         WHERE phase_id = ? AND state = ?`,
      )
      .run(
        phase.requestManifestId ?? null,
        phase.requestHash ?? null,
        phase.state,
        phase.committedResponseId ?? null,
        phase.recoveryAdmissionId ?? null,
        Date.parse(now),
        phase.phaseId,
        existing.state,
      );
    if (changed.changes !== 1) {
      throw new Error(`Provider phase ${phase.phaseId} state conflict.`);
    }
    return;
  }
  database
    .prepare(
      `INSERT INTO provider_phases (
         phase_id, run_id, generation, selection_epoch, source_entry_id,
         context_recipe_id, request_manifest_id, request_hash,
         provider_identity_json, capability_version, capability_kind,
         opaque_state_manifest_id, state, committed_response_id,
         recovery_admission_id, created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      phase.phaseId,
      phase.runId,
      phase.runGeneration,
      phase.selectionEpoch,
      phase.sourceEntryId,
      phase.contextRecipeId,
      phase.requestManifestId ?? null,
      phase.requestHash ?? null,
      encode(phase.providerIdentity),
      phase.capability,
      phase.opaqueStateManifestId ?? null,
      phase.state,
      phase.committedResponseId ?? null,
      phase.recoveryAdmissionId ?? null,
      Date.parse(now),
      Date.parse(now),
    );
}

function readProviderPhase(
  database: DatabaseSync,
  phaseId: string,
): ProviderPhase | undefined {
  const row = database
    .prepare(
      `SELECT phase_id, run_id, generation, selection_epoch, source_entry_id,
              context_recipe_id, request_manifest_id, request_hash,
              provider_identity_json, capability_kind,
              opaque_state_manifest_id, state, committed_response_id,
              recovery_admission_id
       FROM provider_phases WHERE phase_id = ?`,
    )
    .get(phaseId) as
    | {
        phase_id: string;
        run_id: string;
        generation: number;
        selection_epoch: number;
        source_entry_id: string | null;
        context_recipe_id: string;
        request_manifest_id: string | null;
        request_hash: string | null;
        provider_identity_json: Uint8Array;
        capability_kind: string;
        opaque_state_manifest_id: string | null;
        state: string;
        committed_response_id: string | null;
        recovery_admission_id: string | null;
      }
    | undefined;
  if (!row) return undefined;
  return providerPhaseSchema.parse({
    schemaVersion: 1,
    phaseId: row.phase_id,
    runId: row.run_id,
    runGeneration: row.generation,
    selectionEpoch: row.selection_epoch,
    sourceEntryId: row.source_entry_id,
    contextRecipeId: row.context_recipe_id,
    requestManifestId: row.request_manifest_id ?? undefined,
    requestHash: row.request_hash ?? undefined,
    providerIdentity: decode(row.provider_identity_json),
    capability: row.capability_kind,
    opaqueStateManifestId: row.opaque_state_manifest_id ?? undefined,
    state: row.state,
    committedResponseId: row.committed_response_id ?? undefined,
    recoveryAdmissionId: row.recovery_admission_id ?? undefined,
  });
}

export function upsertTimelineRunControl(
  database: DatabaseSync,
  control: RunControl,
  now: string,
): void {
  database
    .prepare(
      `INSERT INTO run_controls (
         run_id, conversation_id, generation, bound_selection_epoch,
         continuation_entry_id, checkpoint_id, wait_group_id,
         provider_phase_id, effective_state, foreground_owned, revision,
         recovery_reason, created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         generation = excluded.generation,
         bound_selection_epoch = excluded.bound_selection_epoch,
         continuation_entry_id = excluded.continuation_entry_id,
         checkpoint_id = excluded.checkpoint_id,
         wait_group_id = excluded.wait_group_id,
         provider_phase_id = excluded.provider_phase_id,
         effective_state = excluded.effective_state,
         foreground_owned = excluded.foreground_owned,
         revision = excluded.revision,
         recovery_reason = excluded.recovery_reason,
         updated_at_ms = excluded.updated_at_ms
       WHERE run_controls.conversation_id = excluded.conversation_id
         AND excluded.revision = run_controls.revision + 1`,
    )
    .run(
      control.runId,
      control.conversationId,
      control.generation,
      control.boundSelectionEpoch,
      control.continuationEntryId,
      control.checkpointId,
      control.waitGroupId,
      control.providerPhaseId,
      control.state,
      control.foregroundOwned ? 1 : 0,
      control.revision,
      control.recoveryReason ?? null,
      Date.parse(now),
      Date.parse(now),
    );
  const persisted = database
    .prepare(`SELECT revision FROM run_controls WHERE run_id = ?`)
    .get(control.runId) as { revision: number } | undefined;
  if (persisted?.revision !== control.revision) {
    throw new Error(`Run control ${control.runId} revision conflict.`);
  }
}
