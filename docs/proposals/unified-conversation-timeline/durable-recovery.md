# Retention, deletion, and durable restore

> **Status: Proposed implementation contract — pending architecture approval.** Part of the [unified conversation timeline proposal](README.md). This document owns backup, deletion, and restore invariants; record layouts and cleanup recipes belong to implementation planning.

## Retention and backup

### INV-BACKUP-01

A restorable backup MUST include canonical history, authoritative execution snapshots/evidence, finalized referenced artifacts, authoritative permission files, and trust/decision evidence. The timeline alone is not a complete backup. Capture file digests and detect concurrent edits; quiesce configuration writers or retry inconsistent capture rather than claiming an atomic file/database snapshot that was not obtained.

Restore validates references, bytes, schema compatibility and permission trust before new authorization. Missing/corrupt evidence blocks affected work rather than authorizing replay; unrelated state may remain inspectable. Historical evaluation evidence remains immutable but cannot replace current file-authoritative policy. [INV-RESTORE-01](#inv-restore-01) governs whether restored execution can proceed.

Canonical history and referenced recovery evidence/payloads remain until explicit owner deletion. Compaction does not delete history. Replaceable projection snapshots may be discarded after safe replacement, but required execution snapshots are not projection caches. Portable moves preserve logical ownership, not stale absolute paths or copied project trust for a different project.

## Deletion finalization and retained evidence

### INV-DELETE-01

Deletion MUST first establish durable intent and fence the owner's history attachment, dispatch and continuation capabilities. Claim enforcement follows [INV-CLAIM-01](execution.md#inv-claim-01); child ownership follows [INV-AGENT-01](execution.md#inv-agent-01). Deletion does not undo external effects.

Deletion remains pending until all of the following are true:

- No new owned work or attachment can be authorized.
- Owned attempts are conclusively settled, proven unstarted, or explicitly abandoned with their uncertainty acknowledged; no requested recovery still needs retained output.
- Private history, snapshots/projections and owner-exclusive payloads scheduled for deletion are removed; shared payloads remain only for another legitimate owner. Pending delivery cannot republish deleted content.
- Durable replay/closure protection remains outside the removed conversation state, and cleanup has no outstanding owner-resource obligations.

Finalization is an irreversible transition after these conditions. Before it, fenced late evidence may settle recovery but cannot undo deletion intent. Explicit abandonment closes recovery without claiming a successful effect; later evidence cannot reopen the request or extend payload retention. After finalization, late owner submissions return `deleted_owner` without accepting payloads, creating detached outcomes, or extending retention.

Replay protection MUST survive conversation cleanup and transport-cache expiry under [INV-RECEIPT-01](timeline.md#inv-receipt-01). Retain enough non-content tombstone/command/effect evidence to reject resurrection and repeated effects, but never replay deleted private response content. Cleanup-progress state is disposable once complete; protection against resurrecting the owner is not. Whether this is represented by reduced receipts, reservations, or other constrained records is an implementation decision.

No automatic timeout converts uncertainty into success or abandonment consent. Pending deletion can remain unresolved until reconciliation or explicit abandonment. Tombstone and replay-protection expiry is not defined in this version and MUST NOT be introduced implicitly; a future expiry decision must address restore/replay safety and disclose deletion semantics. Growth of retained protection is an observability/test-plan concern, not permission to discard it. Field selection, compaction layout and cleanup batch sizes belong to the plan.

## Restore and rollback execution protocol

### INV-RESTORE-01

A backup restores historical evidence, **not execution authority**. Effects performed after capture survive rollback even when their local receipts disappear. Restored readiness or absence of a dispatch record is not proof that dispatch did not occur in the missing interval.

Restore/rollback MUST isolate old writers/dispatchers and promote a fresh, never-reused execution incarnation independent of restored counters. Old claims, mutation sessions, automatic retries and pagination cursors cannot act under that incarnation. The stable state namespace, historical command identities and logical effect keys remain unchanged as evidence. If the old executable instance cannot be isolated, restored dispatch remains disabled. Database fences cannot stop an independent process calling an external service.

Quarantine nonterminal work and invalidate restored leases/continuation rights. Reconciliation may admit fresh claims or a validated new generation only after current policy/trust, history applicability, snapshot compatibility and [INV-EFFECT-01](execution.md#inv-effect-01) replay-safety checks. A provably quiesced interval or surviving external evidence may establish non-dispatch. Otherwise use authenticated effect reconciliation under [INV-RECOVERY-01](execution.md#inv-recovery-01), declared safe-repeat capability, or an explicit unknown/recovery-required disposition. Provider recovery admissions follow [INV-PROVIDER-01](execution.md#inv-provider-01).

Post-backup commands absent from the restored state cannot all be deduplicated from that state. Clients must reconcile and explicitly resubmit desired new work where completion is unknown, with the duplicate-effect consequence made clear. Executable clones require the same isolation and reconciliation; two copies cannot independently resume the same old pending work. Even a verified quiesced move replaces old capabilities before resumption.

Raw replacement behind a live daemon is unsupported. Restore promotion must make its recovery state explicit; accepting lost database writes or restoring valid bytes does not waive execution checks. Rollback to a runtime that cannot enforce them remains non-executing, as required by [INV-MIGRATE-01](migration.md#inv-migrate-01).

## Illustrative failure trace

A backup captures authorized tool T before dispatch. T later changes an external counter, then the older backup is restored. [INV-RESTORE-01](#inv-restore-01) prevents the restored pending record from authorizing another increment: isolate the old instance and reconcile under a fresh incarnation. Without safe-repeat capability or conclusive evidence, T remains unknown until recovery or abandonment. A repeat-safe observation is handled differently under [INV-EFFECT-01](execution.md#inv-effect-01); the backup does not itself decide replay safety.
