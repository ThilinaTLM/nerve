# Unified conversation timeline

> **Status: Proposed implementation contract — pending architecture approval.** This revision defines the intended authoritative target for conversation unification while preserving file-authoritative permission configuration. Its requirements describe the target, not current behavior, approval to cut over, or evidence of completed implementation. Once approved, semantic changes require an explicit revision before implementation diverges.

**MUST** and **MUST NOT** identify architectural requirements in the owning invariant definitions and their attached clauses/state tables. Each `INV-*` ID has one owner; cross-document references apply that rule rather than redefine it. Glossaries, diagrams, worked examples, the overview and decision register are explanatory, not additional normative authorities. **SHOULD** identifies a justified default, not a fixture prescription. Physical names, schemas, UX copy and test parameters belong to implementation planning.

Plans and tests reference invariant IDs through the [coverage map](validation.md#inv-coverage-01). IDs are stable and never silently reused for a different concern; semantic changes revise the owning definition and its dependent contracts explicitly. Review the [decisions/deferred register](decisions.md) before assuming a missing detail is permission to choose new behavior.

## Reading guide and ownership

This directory is one linked target specification, split into independently reviewable topics. This overview explains the decision; each linked document owns its detailed rules. None describes shipped behavior or independently authorizes cutover. Changes to a topic must preserve its cross-document invariants or revise the affected contracts explicitly.

| Document                                              | Owns                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [Timeline authority](timeline.md)                     | Authority split, identity glossary/diagram, ancestry, head updates, atomic transitions, receipts, and semantic outcomes |
| [Run and execution lifecycle](execution.md)           | Checkpoints, wait groups, child ownership, tool/provider attempts, recovery actions, artifacts, and execution examples  |
| [Projections and publication](projections.md)         | Watermarks, fixed-view pagination, branch-safe context boundaries, and client delivery                                  |
| [File-authoritative permissions](permissions.md)      | Policy-file validation/trust, overlay and rule-set recovery UX, and non-atomic remembered saves                         |
| [Retention and durable recovery](durable-recovery.md) | Deletion finalization, retained replay evidence, restore/rollback fencing, and backup safety                            |
| [Migration and delivery](migration.md)                | Legacy proof obligations, cutover, architectural phases, and implementation-plan boundaries                             |
| [Validation and rollout](validation.md)               | Invariant coverage, structural boundedness, architectural responsiveness, and plan-owned measurement obligations        |
| [Decisions and deferred design](decisions.md)         | Chosen alternatives, current-version product constraints, deferred design, and preserved assumptions                    |

Start with this overview, then [timeline authority](timeline.md) and [execution](execution.md). Review permission handling and deletion/restore separately, but do not interpret their separation as waiving cutover dependencies. [Migration](migration.md) must preserve their safety guarantees, and [validation](validation.md) remains the shared release gate.

This revision tightens the architecture boundary: representation fate, retry-capability interfaces and data preservation are decided here; source-version conversion, exact API/schema design, UI copy and benchmark recipes are not. [INV-MIGRATE-01](migration.md#inv-migrate-01) requires preserving supported older user data through migration while the runtime contains only the new design. No compatibility reader/writer or legacy execution path remains active after promotion.

## Decision and scope

Nerve will consolidate conversation history around its existing conversation journal and short SQLite atomic commit boundary. There will be one authority for entry identity, membership, ancestry, active selection, and committed conversation transitions. Runs and the harness will reference that authority rather than maintain competing transcript histories.

This is **not full-system event sourcing**. [INV-AUTH-01](timeline.md#inv-auth-01) keeps execution authorization, attempts, work leases and required immutable snapshots authoritative separately from conversation history; [INV-COMMIT-01](timeline.md#inv-commit-01) defines their atomic relationship. The timeline need not rebuild every execution record.

The intended simplification is specific:

- one immutable entry tree instead of overlapping conversation, run, and harness transcript authorities;
- one transition boundary instead of service-level sequences of correctness-critical writes;
- checkpoint applicability based on canonical references and execution fences instead of transcript-list reconciliation;
- one explicit indeterminate-effect recovery policy instead of inferring execution from missing transcript rows.

### Motivation grounded in existing architecture

Conversation entries already have parent-linked ancestry and an active selection. Run checkpoints separately retain transcript membership and harness references. Reconciling those histories must account for tool results that exist in the conversation but not the run-local transcript.

The storage architecture already provides atomic commits, durable publication intents, lifecycle work, and command receipts. Tool results already use managed artifacts. These are starting points to consolidate, not reasons to add another journal or transport.

Remembering a permission in a file and resolving an approval are separate durable operations. The [file-authoritative permissions contract](permissions.md) defines that deliberate exception to cross-subsystem atomicity without changing the portable-configuration authority.

### Product boundaries retained for review

Current-version ownership/navigation policy is defined once in [INV-HEAD-01](timeline.md#inv-head-01), not inferred from storage. [Deferred steering and parallel ownership](decisions.md#deferred-design) name the head, checkpoint, barrier and provider invariants they must preserve or explicitly revise. Do not implement speculative exceptions to today's target.

### Goals

1. Unique, durable conversation identities and immutable ancestry.
2. Atomic logical transitions with explicit idempotency and concurrency behavior.
3. Safe checkpoint continuation, including sibling tool waits.
4. Recovery that distinguishes committed, superseded, cancelled, and indeterminate work.
5. Independently rebuildable UI, model-context, search, and delivery projections.
6. Bounded interactive writes and reads with portable local-first storage.
7. Removal of obsolete transcript authorities at cutover.

### Non-goals

- One table, one mutable conversation document, or one representation for humans and models.
- Persisting each streaming token or operational heartbeat as a timeline event.
- Rebuilding lost execution authorization from transcript text.
- Exactly-once external effects for arbitrary tools.
- Full-history replay on ordinary reads or every startup.
- Filesystem, model, user, or network waits inside database transactions.
- A new database service, global application execution lock, or permanent dual-write compatibility layer.
- Introducing multiple independent foreground runs on the same active conversation path.
- Automatic deletion of canonical history through model compaction.
- Moving permission configuration or secrets into SQLite, guaranteeing atomic file/database writes, or changing permission evaluation precedence, target normalization, or hard guardrails.

## Decisions and alternatives

The [register](decisions.md#decided-target) records the selected architecture and rejected alternatives: continued transcript reconciliation, unchanged run/harness authority, full-system event sourcing, notification-owned history, SQLite-authoritative permission files, and default export/reset. The [preserved assumptions](decisions.md#preserved-architectural-assumptions) retain portable SQLite and current policy guardrails rather than introduce a database service. Concrete migration mapping is deferred, but the fate of the existing representations is not: see [INV-AUTH-01](timeline.md#inv-auth-01).
