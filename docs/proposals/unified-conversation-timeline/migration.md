# Migration and delivery boundaries

> **Status: Proposed implementation contract — pending architecture approval.** Part of the [unified conversation timeline proposal](README.md). This document owns data-preservation and cutover decisions. Concrete source-version conversion and repository mappings belong to the implementation plan.

## Migration and cutover

### INV-MIGRATE-01

**Preserve existing user data through migration; run only the new design afterward.** Supported released histories, branches, meaningful model-context content, artifacts and required evidence MUST survive conversion into the target authority model. Default export-and-reset is rejected. If execution safety cannot be proved, retain history while making affected runs non-resumable or recovery-required; preservation is not a promise to resume every old run.

The target runtime MUST contain no legacy transcript readers/writers, compatibility checkpoint semantics, parallel history authorities or old execution paths. Old-format knowledge is confined to versioned migration code that produces validated target state. It is not a runtime fallback and is inactive after promotion. There is one production write authority at a time; no indefinite dual-write or read-compatibility phase.

Migration must be restart-safe: quiesce writers/dispatchers, verify a restorable backup, convert unpublished staged state, validate it, and atomically promote the complete target format/authority. Interrupted conversion leaves intact old authority or a validated new authority, never an executable hybrid. Bounded conversion work and backup integrity follow [INV-PERF-01](validation.md#inv-perf-01) and [INV-BACKUP-01](durable-recovery.md#inv-backup-01).

Irreconcilable history/identity corruption blocks promotion with actionable diagnostics and recoverable old state; it does not silently discard a branch or reset the database. A user-initiated reset is a separate explicit data-deletion operation, not successful migration or an automatic error handler. The implementation plan must enumerate supported released source versions and conversion paths before migration work is scheduled; missing coverage cannot be hidden by adding a legacy runtime reader.

Older binaries reject the promoted format. Before promotion, staged work can be discarded and intact old authority reopened. After new writes, rollback requires the verified backup and [INV-RESTORE-01](durable-recovery.md#inv-restore-01), not an automatic down-migration. A rollback runtime unable to enforce restore safety cannot dispatch. Retained pre-cutover data is recovery material, not a second live implementation.

### Permission preservation during migration

This is an application of [INV-POLICY-01](permissions.md#inv-policy-01) and [INV-MIGRATE-01](#inv-migrate-01): preserve authoritative files, owner/rule-set bindings and source digests; do not migrate permission authority into SQLite or introduce an activation workflow. Preserve trust only when complete-document identity and project binding match. Failed documents follow their owning policy invariants; migration cannot manufacture reset/fallback consent.

Preserve remembered-save evidence without inferring tool execution from file contents. Pending authorization must be evaluated against valid current policy before a fresh claim. Backups and rollback include files and evidence together, with explicit handling of later external edits.

## Legacy authority and proof obligations

### INV-MIGRATE-02

Migration MUST preserve facts from their validated owning source, not whichever representation is newest, largest or easiest to hydrate. The target fate of each current representation is decided by [INV-AUTH-01](timeline.md#inv-auth-01); this invariant defines the proof needed to carry its content into that target.

| Fact                                   | Proof obligation                                                                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| History identity, content and ancestry | Validate the source format's committed history/integrity and parent membership. Reconcile unique meaningful context facts into the target without creating a second tree; incompatible authoritative histories block promotion                                |
| Active selection                       | Use the validated owning selection linked to committed history. A context/harness leaf is corroboration, not permission to select a competing branch                                                                                                          |
| Authorization, effects and outcomes    | Use validated execution/effect and policy evidence. Transcript presence alone does not authorize an effect, and missing output is not proof of non-dispatch                                                                                                   |
| Checkpoint and wait ownership          | Require the committed compatible snapshot selected by authoritative run control, proven canonical anchor ancestry, and complete member/attempt linkage                                                                                                        |
| Unique non-history context facts       | Classify into owning domain state or immutable execution/context-recipe data under INV-AUTH-01. Preserve unclassified content as inert evidence; do not enable a legacy runtime reader. Unresolved meaning needed for correctness blocks promotion/resumption |
| Disposable projections                 | Rebuild from proved owners. Staleness alone is not corruption; unresolved disagreement about an authoritative fact requires proof/repair before promotion, not an arbitrary winner                                                                            |

Select the checkpoint named by the latest validated committed run-control state in its owning order, not wall-clock time or longest transcript. Do not fall back to an older checkpoint merely because the selected one is incompatible: later effects may already have occurred. Ambiguous execution linkage makes the affected run non-resumable and pending interactions superseded; possible effects require recovery under [INV-EFFECT-01](execution.md#inv-effect-01). This does not authorize loss of history.

Import ordering records source order/provenance without fabricating cross-journal chronology. Preserve stable entry/effect identities and compatible command replay protection. Incompatible old receipts reserve/reject their old keys rather than treating a retry as a new command. Initialize target selection/generation fences as an explicit import baseline; do not infer past navigation from matching numeric positions. Legacy claims cannot survive as execution permission.

Conversion MUST NOT execute tools/models to manufacture missing evidence. Capability migration uses version-specific proof, not today's tool risk label. Missing/unverifiable payloads and conflicting parentage need repair or a separate explicit data-recovery decision before promotion; they are not silently omitted.

The implementation plan supplies the source-version authority/evidence matrix, exact legacy store precedence, integrity checks, mapping algorithms and disagreement fixtures. Those choices must prove this invariant and the declared representation fate before conversion implementation; names such as “journal” or “projection” are not proof by themselves.

## Architectural delivery phases

The sequence below is planning guidance subject to the invariant dependencies, not file-level ownership or a schedule:

1. Establish target contracts and transition ownership, including the representation-fate and tool-capability interfaces.
2. Remove duplicate history membership/selection authority; implement canonical entry/head references and checkpoint applicability.
3. Integrate wait barriers, claim/retry capabilities, provider phases and child lifecycle.
4. Integrate projections, typed consumer outcomes, file-permission partial outcomes, and durable recovery/deletion fences.
5. Prove migration on supported source formats and run the [invariant coverage](validation.md#inv-coverage-01) checks before controlled promotion.
6. Remove all target-runtime legacy access paths and demonstrate that migrated state runs solely under the new design.

### Planning prerequisites

Before consumer integration, define typed outcomes from [INV-OUTCOME-01](timeline.md#inv-outcome-01). Before tool execution integration, classify supported operations under [INV-EFFECT-01](execution.md#inv-effect-01). Before migration implementation, finish the source-version proof matrix above. Source paths, tables, tuned limits and test commands belong in that plan.

The plan's mutation inventory must account for user/queued input, model output, tool/child results, interactions, file-save evidence, navigation, summaries, cancellation/recovery, deletion and cross-conversation plan acceptance. Every path maps to the owning transition or is explicitly non-history state. This is coverage evidence for [INV-AUTH-01](timeline.md#inv-auth-01) and [INV-COMMIT-01](timeline.md#inv-commit-01), not permission to add another event framework.
