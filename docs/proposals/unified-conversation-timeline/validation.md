# Architecture validation and coverage

> **Status: Proposed implementation contract — pending architecture approval.** Part of the [unified conversation timeline proposal](README.md). This document owns architectural performance and coverage obligations, not fixture recipes, UX tests, or benchmark parameter selection.

## Storage and performance requirements

### INV-PERF-01

Interactive transition cost MUST be bounded by the changed records and payload references, not total conversation history. Appending cannot rewrite/hydrate the full history or rebuild all projections. Normal reads are bounded/paginated; startup hydration is lazy. Cancellation, deletion and rebuild/cleanup work are bounded and yield without delaying the effective fence defined by their owning invariant.

Model/tool/network waits and artifact hashing/IO remain outside the hot database transaction under [INV-COMMIT-01](timeline.md#inv-commit-01) and [INV-ARTIFACT-01](execution.md#inv-artifact-01). Synchronous maintenance is limited to correctness-critical state. SQLite's single writer is acceptable; a long-lived application-wide execution lock or history-sized synchronous work is not.

Representative interactive operations MUST meet an explicit responsiveness budget and show no material p95 latency regression against an agreed comparable baseline. Measure command queue wait separately from transaction duration, artifact preparation, and projection lag. Structural boundedness plus a small reproducible latency smoke is required; passing a timing test does not excuse unbounded algorithms.

The implementation/test plan fixes the baseline method, absolute budget, material-regression threshold, offered load and reference environment before collecting acceptance results. It also chooses payload sizes, histories, sample/warm-up counts, disk budgets, fixture seeds and statistical methods. No particular sample count, large-history fixture, concurrency sweep, or artifact volume is mandated by this architecture. Broad scale sweeps are optional diagnostics, not independent cutover gates. Existing baseline measurements may be used when comparable; retaining a legacy runtime/benchmark framework is not required.

## Invariant coverage

### INV-COVERAGE-01

The implementation plan and automated tests MUST reference stable invariant IDs rather than invent paraphrased contracts. Every owning invariant has evidence before the affected integration/cutover phase completes. The map below identifies evidence categories; concrete tests, fixtures, API names, commands and numeric parameters belong to the test plan. Examples in topic documents are illustrations, not additional normative owners.

| Owning invariant                                     | Required evidence category                                                                                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [INV-AUTH-01](timeline.md#inv-auth-01)               | Target representation audit and mutation inventory proving one history/selection authority and removal of duplicate runtime writers                                          |
| [INV-ID-01](timeline.md#inv-id-01)                   | Identity, ownership, immutable ancestry, order, empty-root and cross-conversation identity tests                                                                             |
| [INV-HEAD-01](timeline.md#inv-head-01)               | Transition-by-transition head/selection checks, navigation away/back, attachment and fenced-owner races                                                                      |
| [INV-COMMIT-01](timeline.md#inv-commit-01)           | Failure injection across logical commits, including multi-conversation acceptance and publication intent                                                                     |
| [INV-RECEIPT-01](timeline.md#inv-receipt-01)         | Replay/mismatch behavior after later commits, cache expiry, deletion and reconnect                                                                                           |
| [INV-OUTCOME-01](timeline.md#inv-outcome-01)         | Typed outcome discrimination and consumer handling without error-text inference                                                                                              |
| [INV-CHECKPOINT-01](execution.md#inv-checkpoint-01)  | Compatible/incompatible snapshots, ancestry/fence applicability, sibling waits and no transcript-list comparison                                                             |
| [INV-BARRIER-01](execution.md#inv-barrier-01)        | Legal member transitions, non-dispatch proof, missing/unknown output and single continuation entitlement                                                                     |
| [INV-AGENT-01](execution.md#inv-agent-01)            | Independent child lifecycle, parent fences, parent-result attachment and explicit cancel propagation                                                                         |
| [INV-EFFECT-01](execution.md#inv-effect-01)          | Tool declaration audit, verified observation replay, non-repeatable effects, conditional/external idempotency, key stability and upgrade/migration compatibility             |
| [INV-CLAIM-01](execution.md#inv-claim-01)            | Claim replacement/expiry, stale settlement, cancellation/dispatch races and work redelivery                                                                                  |
| [INV-RECOVERY-01](execution.md#inv-recovery-01)      | Authenticated effect reconciliation, supplied-output provenance, fresh-observation admission preserving prior attempt evidence, same-run recovery and abandonment/detachment |
| [INV-PROVIDER-01](execution.md#inv-provider-01)      | First/next phase obligations, retry capability, prepared responses, opaque state and late/competing provider responses                                                       |
| [INV-ARTIFACT-01](execution.md#inv-artifact-01)      | Preparation/reference crash boundaries, ownership, pinning, corruption and cleanup races                                                                                     |
| [INV-VIEW-01](projections.md#inv-view-01)            | Per-store watermark atomicity, lag/rebuild and filtered-transition advancement                                                                                               |
| [INV-PAGE-01](projections.md#inv-page-01)            | Fixed-view pages across appends/navigation, authorization changes, deletion and restore                                                                                      |
| [INV-CONTEXT-01](projections.md#inv-context-01)      | Transitive summary provenance, competing boundaries, fork/navigation and policy/visibility changes                                                                           |
| [INV-DELIVERY-01](projections.md#inv-delivery-01)    | At-least-once delivery, deduplication and independent desktop/mobile reconnect reconciliation                                                                                |
| [INV-POLICY-01](permissions.md#inv-policy-01)        | Fresh file evaluation, complete-document trust, external edits and evidence/authority separation                                                                             |
| [INV-POLICY-02](permissions.md#inv-policy-02)        | Affected-only pause, repair/reset consent, stale confirmation and persistent failure semantics                                                                               |
| [INV-POLICY-03](permissions.md#inv-policy-03)        | Invalid/unselected custom policies, externally repaired files, explicit durable fallback and incompatible prior approvals                                                    |
| [INV-POLICY-04](permissions.md#inv-policy-04)        | Save/finalization partial outcomes, external-edit conflicts and interrupted-save recovery                                                                                    |
| [INV-BACKUP-01](durable-recovery.md#inv-backup-01)   | Complete portable backup, file/database capture consistency and integrity validation                                                                                         |
| [INV-DELETE-01](durable-recovery.md#inv-delete-01)   | Finalization predicates, late evidence boundary, erased-content protection and retained replay evidence                                                                      |
| [INV-RESTORE-01](durable-recovery.md#inv-restore-01) | Effects occurring after backup then rollback, fresh incarnation, old-worker/client isolation and recovery admission                                                          |
| [INV-MIGRATE-01](migration.md#inv-migrate-01)        | Supported-source preservation, restart-safe promotion, corrupt-history failure and new-only runtime                                                                          |
| [INV-MIGRATE-02](migration.md#inv-migrate-02)        | Source-version proof fixtures, unique history/non-history context preservation, unclassified evidence, disagreements, checkpoint selection and receipt/capability conversion |
| [INV-PERF-01](#inv-perf-01)                          | Structural boundedness and agreed interactive latency smoke; retained-evidence growth observed rather than silently expired                                                  |
| [INV-COVERAGE-01](#inv-coverage-01)                  | Reviewable plan/test links covering every invariant and no unowned normative behavior                                                                                        |

### Fault-boundary evidence

Test durable reopened state, not only mocked return values. Include faults before/after authorization, external dispatch, result preparation/commit, provider claim/response commit, permission save/finalization, recovery/abandonment, projection advancement, and migration/restore promotion. Include an external effect after backup capture and a late old worker/client after restore. A repeat-safe observation and a non-repeatable mutation require distinct test outcomes; an idempotency-capable integration needs proof of its declared scope/window behavior.

These are boundary classes, not a mandated Cartesian test matrix. Tests must demonstrate the owning invariants, including explicit file/database partial outcomes, without relying on a missing transcript result as execution evidence. All validation runs use isolated state/endpoints/profiles rather than live user data or services.

### Release evidence

Cutover requires invariant coverage, a validated supported-source migration, and an audit showing that only the new runtime design can read/write target history. Source-version mappings and tool-by-tool capability classification are prerequisites for their implementation phases, not topics to defer until a failing release. UX copy, component layout, storage compaction fields, large benchmark sweeps and operational commands are outside this contract.
