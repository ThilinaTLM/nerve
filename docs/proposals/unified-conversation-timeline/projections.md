# Projections, context, and publication

> **Status: Proposed implementation contract — pending architecture approval.** Part of the [unified conversation timeline proposal](README.md). The overview defines the shared status and normative language; this document owns the detailed contract for its topic.

Owns consumer views, historical pagination, context provenance, and delivery. Canonical facts come from [timeline authority](timeline.md); [restore](durable-recovery.md#restore-and-rollback-execution-protocol) invalidates old cursors and execution authority.

## Projections, context, and reliable publication

### Projection contract

#### INV-VIEW-01

Each projection records its schema/policy version and per-conversation applied revision. Applying a transition and advancing that projection's watermark MUST be atomic **within that projection's own store**. For asynchronous projections this is a separate transaction after the canonical commit, not enlistment in the canonical transaction or a distributed transaction. Only correctness-critical synchronous projections participate in the canonical commit. Filtered-out transitions still advance the watermark; otherwise omission looks like lag.

Correctness reads use the authorities in [INV-AUTH-01](timeline.md#inv-auth-01), not these rebuildable views. Transcript/search pages may be eventually consistent but return their watermark alongside the canonical revision. A projection ahead of canonical state, referencing nonexistent entries, or reporting incompatible versions fails explicitly. A rebuilding projection MUST NOT silently replace newer data with an older snapshot.

Reads requiring read-your-write behavior accept a minimum committed revision or reconcile directly against canonical records. Ordinary transcript queries are indexed and paginated; they do not replay the journal. Projection lag must be visible through revision distance, oldest pending work age, last error, and rebuild state.

### Stable transcript pagination

#### INV-PAGE-01

The first page establishes a fixed view: conversation identity, immutable source head, source revision/watermark, projection schema/policy version and rebuild generation, visibility/filter identity, ordering, and page position. An opaque validated cursor binds these fields plus the execution/storage incarnation needed to reject pre-restore cursors. It is not just a numeric offset or a reference to whatever head is active now.

Subsequent pages MUST either continue that same historical view or return an explicit `reconciliation_required` result with a reason and fresh-view entry point. Navigation and appends do not change the cursor's source head. A response may separately report the current active head/revision, but must not substitute it into historical rows. Entry membership/order and content projections use the bound revision and version; mutable current tool/run status is either rendered as of that revision or returned as a separately labelled current-status overlay, never silently mixed into the snapshot.

Each page rechecks current access/visibility authorization. Deleted history, revoked access, unavailable historical projection versions, incompatible filters, lost snapshots, expired cursors, or restore invalidation produce explicit reconciliation/access/deletion responses, not mixed-branch pages. A projection that has not reached the requested source revision reports lag rather than supplying a partial newer/older view. Equivalent reconstruction from canonical state is allowed; a rebuild that cannot preserve the bound view invalidates its cursors. No database read transaction or lock stays open between page requests.

### Model context and summaries

#### INV-CONTEXT-01

The model-context recipe identifies canonical source history, summary/source boundaries, policy version, visibility rules, and provider adapter version. Cached provider messages retain canonical provenance, even when multiple entries are grouped or omitted.

A summary references an exact source tip/range or immutable source manifest and its generation inputs/version. It does not rewrite source ancestry or delete underlying entries. A context boundary is non-visible lifecycle evidence unless a summary entry is intentionally shown. Only selected-branch ancestors may become model history; detached outcomes are not silently inserted.

Context boundaries are **branch-anchored**, not conversation-wide or selection-epoch-scoped. Each names an immutable anchor/source tip, covered ancestry, policy/version, and complete conversation-derived input provenance, including transitive summary inputs. A boundary is eligible only if its anchor and every conversation entry used to generate it belong to the selected source head's ancestry, its covered range is valid, its commit is within the view revision, and current visibility/context policy permits all inputs. Input provenance cannot be filtered after generation to hide off-branch information: a summary that saw a sibling branch is ineligible even if its visible text appears generic.

Choose one effective boundary deterministically: among eligible boundaries for the selected context-policy version, prefer the deepest anchor on the selected ancestry; for the same anchor, choose the latest committed boundary by revision and within-transition ordinal. Use canonical identity as the final tie-breaker. Do not implicitly combine competing boundaries or fall back to an incompatible policy version. With none eligible, build context from that ancestry without a summary, subject to normal context limits, or create a new summary at a safe boundary.

Navigating to an ancestor before a boundary's source tip makes it ineligible; a fork from that ancestor does not inherit it. Returning to a descendant of the original source tip may make it eligible again, although old execution checkpoints remain fenced by their selection epoch. Navigation MUST recompute boundary eligibility rather than carrying forward a cached active summary. Committing a newly generated summary also revalidates source provenance/applicability so concurrent navigation cannot attach stale off-branch context.

Provider continuation state retains the execution-snapshot authority assigned by [INV-AUTH-01](timeline.md#inv-auth-01); compatibility and resumption follow [INV-CHECKPOINT-01](execution.md#inv-checkpoint-01) and [INV-PROVIDER-01](execution.md#inv-provider-01), not cache reconstruction. Rebuilding a model projection MUST NOT execute tools, invoke a model, or invent previously unseen reasoning to repair a checkpoint.

A context boundary during a wait group may change the next request's recipe if committed with the corresponding new snapshot and without changing membership or inputs. During an in-flight provider request it must wait for a safe boundary or explicitly fence that phase; it cannot retroactively change what the provider saw.

### Outbox and delivery

#### INV-DELIVERY-01

Reuse publication intents made durable by [INV-COMMIT-01](timeline.md#inv-commit-01). Delivery is ordered within its declared stream and **at least once**, not exactly once. Event intent identities are stable; consumers deduplicate. Publication payloads identify the canonical revision and changed identities; transport sequence numbers are not branch positions.

A notification may arrive before an asynchronous projection catches up. Subscribers either wait for its revision or fetch a canonical reconciliation view; they must not infer data loss from that race. Expired delivery cursors trigger snapshot reconciliation under the existing protocol, not replay from an invented transcript event stream. Delivery acknowledgement/retention never deletes canonical history. Desktop and mobile clients consume the same canonical identities and semantic outcomes; each client's delivery progress is independent. Reconnection reconciles its own view/cursor without creating a client-specific transcript authority. [INV-RESTORE-01](durable-recovery.md#inv-restore-01) invalidates pre-restore authority for every client, not only the one initiating restore.

## Worked examples

These traces illustrate [INV-PAGE-01](#inv-page-01), [INV-CONTEXT-01](#inv-context-01), [INV-DELIVERY-01](#inv-delivery-01), and [INV-RECEIPT-01](timeline.md#inv-receipt-01); they do not define additional rules.

### Summary and pagination across a fork

A summary covers ancestry through H. A transcript page binds source head H, view revision R and projection version V. Navigation selects ancestor A of H and appends fork F. Context at F cannot use the summary through H or any summary transitively derived from H's excluded descendants. The next transcript page using the old cursor still reads the path ending at H under R/V, or explicitly requires reconciliation; it never switches to F. Returning to H may reuse the summary but does not revive the old run checkpoint.

### Duplicate commands and delivery lag

A resolution commits at 80 but its response is lost. Retrying the same key/fingerprint returns its revision-80 receipt even when the head is at 85. Changing answer or grant scope under that key fails. An outbox notification for 80 may be delivered twice while the UI projection is at 79; deduplication plus watermark-aware reconciliation produces one action/result, without altering canonical history.
