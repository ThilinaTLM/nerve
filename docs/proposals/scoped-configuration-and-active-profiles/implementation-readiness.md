# Implementation plan and acceptance gates

Product decisions are settled in the linked specification. This is a plan, not permission to run destructive migration on user data. Obtain explicit review of the exact database migration before executing it.

## Delivery order

### 1. Contracts and resolver

Implement strict sparse and complete schemas from [schemas](schemas.md), profile definitions (`schemaVersion: 1`), creation preferences, health diagnostics and optional list-summary fields. Export JSON Schema for editor support. Implement pure resolution, canonical merge units, provenance, role projection, requirement overlap and skill-source default handling.

Gate: fixture tests cover every field's omission/reset/false/atomic behavior; no input parser silently materializes defaults or strips unsupported values. Child launch choice B must survive a profile recommendation A on follow-up. Required model can supply an otherwise missing child model.

### 2. Scope store and cache

Reuse serialized atomic file primitives. Add expected revision/digest checks, scope loading/health, complete-generation publication and dependent invalidation. Implement direct UI-save publication, no filesystem watchers. Add the disposable JSON summary cache; it is not execution authority. Remove remember-last-selection from contracts, server and UI.

Gate: conflicting saves and external edits cannot silently overwrite detected divergent bytes; failed persistence does not publish; failed publication makes scope unavailable until authoritative reload. Routine startup does not enumerate conversation documents.

### 3. Runtime and policy integration

Route effective config consumers through the service: previews, composer, model preparation, executor configuration, compaction/retry, sub-agent preflight and permission admission. Remove host-side rereads that bypass captured settings. Enforce child bans independently at execution. Handle approved/queued/recovered calls through the final authorization gate.

Gate: model changes mid-stream affect the next request; current permission changes affect the next execution; approval cannot defeat a later denial; after restart, calls are re-captured and a changed target requires fresh approval. Current permission recovery approval fallback is replaced by configuration-blocked waiting with Retry/Cancel.

### 4. Profile and approval UI

Replace old Set/Lock/Reset/Same-as-lead editors with Use settings/Recommend/Require. Show effective source and update/reapply actions. Add bounded child invocation controls and skill defaults. Plan approval previews target requirements and handles stale-target refreshed confirmation without failing the review irreversibly.

Gate: Planning → Coding preserves choices; requirement conflicts are visible; accepted model/profile transition commits once; uncommitted failed attempts release locks and permit repair/new confirmation.

### 5. Recovery and migration

Extend existing settings health, activity notice, toast, reset confirmation and upgrade report. Implement previewed source-bound repair receipts/backups and domain readiness. Build registered document converters and the storage-wide export/drop migration. Preserve current history/context ownership.

Before DDL: replace SQL joins and context/config consumers, update required-list-field contracts, verify exported documents and collisions, review rollback/receipts, and obtain exact migration approval. Convert from released v0.37.0 inputs only. Report dropped conversation sub-agent fields, removed parent-copy behaviour, folded remembered selections and re-granted trust.

Gate: migration interrupted before/after export, verification and database commit resumes safely; no dropping columns with unverifiable exports. Copied-slot rehearsal uses storage created by v0.37.0. It covers harness remember-last folding, `mode` → applied profile, sub-agent catalog splitting, skill disable/patch, child freezing, untrusted project files and duplicate targets.

### 6. Remove obsolete runtime paths

Retire migrated harness/capability/applied-policy readers and SQLite agent-column assumptions. Keep frozen migration readers where necessary; do not retain a runtime compatibility layer. Preserve unchanged domain schemas/locations from the registry. Update architecture docs and user-facing reset/restart explanations.

## Acceptance matrix

| Area        | Required scenarios                                                                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resolution  | Empty/sparse overrides, field resets, false, atomic model/union, source defaults, requirement overlap, effective provenance                                                             |
| Profiles    | Switch/reapply, unchanged old snapshot after catalog edit/delete, exact trust on new apply, Planning requirements, explicit custom shadowing                                            |
| Children    | No parent inheritance, project→conversation launch overrides, frozen full preferences, live independent security policy, role-projected resources, execution-level delegation rejection |
| Activation  | Request capture vs current policy, retries/compaction, parallel admission, approval recheck, current launch enablement                                                                  |
| Persistence | Stale revision/digest, missing optional file, missing required conversation file, publication failure, disposable cache loss                                                            |
| Recovery    | Unknown field, malformed JSON, future version, invalid/missing references, unreadable storage, invalid required policy, first-load blocked feature, runtime retained memory             |
| Migration   | Every v0.37.0 input, sub-agent split, skill disable/patch, renamed fields, parent-copy removal, re-granted trust, export/drop ordering, interrupted receipts and target collisions      |
| UI          | Source labels, locked controls, repair preview vs dismissal, activity/toast reuse, update-profile notice, unknown list summaries                                                        |

## Validation

Design work: review Markdown, examples, links and decision consistency; no runtime tests required for these docs-only changes.

Implementation: relevant owning-layer unit tests plus `pnpm fix:focused && pnpm check:focused`. Migration rehearsal uses copied/fresh storage, never slot 1. Integration/browser suites only when explicitly requested. Avoid claiming focused checks equal full release validation.
