# File-authoritative permissions and atomicity

> **Status: Proposed implementation contract — pending architecture approval.** Part of the [unified conversation timeline proposal](README.md). Invariant IDs identify the owning rules; interaction layout and copy belong to implementation/UX planning.

## File authority and evaluation

### INV-POLICY-01

Permission configuration MUST remain file-authoritative. User-, project-, and conversation-scoped overlays and mutable custom rule sets are authoritative JSON documents; built-in rule sets are immutable application definitions. SQLite stores trust, approval decisions, exact-call authorization, and historical evaluation evidence, not another effective copy of permission configuration. This preserves the [storage](../../architecture/storage.md) and [permission-rule-set](../permission-rule-sets.md#storage-and-portability) authority boundaries.

Custom rule sets are authored externally; in-app remembered grants edit overlays, not custom rule sets. No import/apply workflow or watcher is required to activate file edits: applicable documents are read and validated at evaluation, including before a new execution claim. A cached parse is reusable only after source freshness is established. Reads, hashing, and evaluation occur outside database transactions; authorization binds the exact observed document digests, normalized inputs, selected rule set, and trust evidence.

The last validated observation used for a claim is its authorization boundary. External edits cannot be locked atomically with dispatch; later edits do not retroactively undo claims or effects. Delayed/conflicted claims require fresh evaluation. Historical evidence cannot override current files for new authorization.

Project trust covers the complete document digest and project identity. A changed document does not inherit trust from a path or a single-call approval. An application-authored scoped grant can establish successor trust only with a trusted complete predecessor, unchanged unrelated content, and explicit consent to that rule/scope; otherwise whole-document trust is required. Copying/rebinding policy to another project does not copy trust. Evaluation precedence, rule-set binding, normalized targets and hard guardrails remain unchanged.

Digest changes do not alone supersede sibling approvals. Re-evaluation may preserve an interaction only if its bound inputs, requested authority, selected rule set and offered scope remain valid. Incompatible or forbidden requests are terminalized and, where appropriate, replaced by a new decision. Approval scope cannot silently broaden. Applicability is otherwise owned by [INV-CHECKPOINT-01](execution.md#inv-checkpoint-01).

## Invalid overlays

### INV-POLICY-02

A malformed, unsupported, or unreadable applicable overlay MUST pause new execution of affected tool calls, including manual exact-call execution, until repair or explicitly confirmed reset. It MUST NOT prevent startup, history inspection, model interaction, cancellation, repair actions, or unrelated work. Ignoring the overlay is not inherently conservative: it may contain restrictions as well as grants.

The user must be informed of the affected document/scope, failure, and pending work, and be able to repair/retry, explicitly remove/reset the failed overlay, or leave affected work paused. Reset consent acknowledges that removing the entire overlay can remove restrictions. Absence or dismissal of consent is not permission to proceed. The unresolved condition remains discoverable across client reconnection/restart; presentation and notification frequency are not architectural requirements.

Do not silently discard failed documents. Preserve recoverable contents where available; if preservation or removal fails, disclose the limitation rather than report success. Reset is bound to the observed failure/document identity: a changed or repaired file requires revalidation, not stale deletion. If quarantine is used, its unresolved status must survive restart so missing active-path bytes do not masquerade as valid absence.

After repair/reset, re-evaluate all applicable policy/trust and pending run applicability. Reset itself is not blanket tool approval and cannot revive superseded work. A valid external deletion removes an overlay at the next evaluation; an unreadable document or unresolved quarantine is not such a deletion.

## Invalid custom rule sets

### INV-POLICY-03

Invalid custom rule sets MUST be excluded from the valid catalog/effective policy and preserved for external repair, not automatically edited or deleted by Nerve. A warning identifies the source and error and supports revalidation. An invalid unselected rule set does not interrupt execution under a valid selected policy.

If the selected rule set is missing, invalid or incompatible, affected new tool execution waits for repair or explicit fallback consent; the harness and unrelated work remain available. The user must be told that Baseline can be less restrictive than the unavailable custom policy. Fallback consent selects **Baseline without user, project, or conversation overlays**, subject to all enclosing agent/mode and host guardrails. It is not approval of a pending tool call.

Record requested policy, observed failure and effective fallback as durable selection/decision evidence. Preserve confirmed fallback across restart until explicit selection of a valid policy; repairing the original file does not silently switch back after fallback consent. Revalidate source/selection on confirmation to reject stale decisions. Repair without fallback resumes evaluation under the still-selected valid policy. In either case, supersede incompatible prior approvals/authorizations rather than transferring them silently.

While fallback disables overlays, their failures do not block that fallback's calls; their files/diagnostics remain, and selecting a policy that enables them restores normal validation. No confirmation means no fallback. Exact button labels, file-opening affordances and dialog design are implementation/UX choices.

## Remembered grants: separate, recoverable steps

### INV-POLICY-04

A remembered overlay save and its originating approval resolution are **not** one atomic operation. Exact-call resolution, authorization and run state follow [INV-COMMIT-01](timeline.md#inv-commit-01); authoritative file writes do not enlist. A saved grant may become visible to future evaluations before approval finalization, or remain effective after that approval is superseded. This accepted partial outcome must be distinguishable from tool execution.

Record the user's save intent with stable identity, rule/scope and observed/expected document fingerprints before writing. Serialize application-owned saves, detect observed external conflicts, and prefer atomic file replacement to reduce partial writes; do not claim filesystem CAS against arbitrary external editors. Reload/validate saved policy and trust before finalizing a still-applicable exact-call resolution.

Failure to save is not a remembered grant. A separate single-call decision is available only with valid applicable policy and explicit user choice, never as silent scope downgrade. Saved-but-unfinalized approval is not rolled back by pretending the file did not change. Recovery reconciles recorded intent against current files and applicability; it never blindly overwrites a newer edit, reinserts a removed rule, rolls back a shared grant, or repeats tool execution. Replays reconcile the existing operation under [INV-RECEIPT-01](timeline.md#inv-receipt-01).

## Portability and backup

[INV-BACKUP-01](durable-recovery.md#inv-backup-01) owns backup/restore consistency across files and database evidence. User/project overlays outlive an individual conversation; conversation overlays follow their owner. These are logical ownership boundaries, not permission to reproduce deleted conversation data from an old cache.

## Illustrative failure trace

A project-scoped save succeeds, then the process exits before approval finalization. Matching file contents and trust prove the save, not execution. Recovery re-evaluates the pending action. If navigation superseded it, the grant remains authoritative and that residual grant is reported. If the user changed/removed the rule, recovery reports a conflict without restoring the old file. This illustrates [INV-POLICY-04](#inv-policy-04), not a second recovery rule.
