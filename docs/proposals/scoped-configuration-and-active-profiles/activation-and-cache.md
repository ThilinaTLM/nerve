# Activation and cache contract

## Boundaries

| Configuration                                                             | Capture/activation boundary                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Model, reasoning, instructions, available tools/skills/sub-agent profiles | Before each newly prepared LLM request                                               |
| Non-security tool configuration (account ID, interpreter, limits)         | Captured with the request that advertises the tool                                   |
| Permission selection, applicable policies and hard role restrictions      | Immediately before each tool execution admission, including approved/recovered calls |
| New child invocation model/reasoning and selected profile                 | Latest validated configuration at launch; capture once for that child                |
| Compaction preferences                                                    | Start of each compaction operation                                                   |
| Automatic retry preferences                                               | Start of a retry sequence                                                            |
| Manual response retry                                                     | Reuse the already prepared request, as today                                         |
| Runner-managed retry/post-compaction request                              | New preparation using current configuration                                          |

Changing a model during streaming does not rewrite that request. Turning a tool off affects the next advertised toolset, not an already-issued call's captured executor configuration. To stop a pending call immediately, change its applicable permissions or cancel the work. Calls admitted before a policy change are not retroactively cancelled by that change.

Launch-time profile resolution is an explicit exception to request-captured ordinary tool settings: advertised profile names are not authorization. Reject a newly disabled/untrusted/unavailable profile at launch rather than substituting another. A child caller is independently forbidden from delegation at execution.

## In-memory service

JSON is persisted authority. Keep validated sparse scope documents, validation health, dependency generations and immutable effective views in memory. No separate persisted last-known-good settings store.

- Configuration service owns lazy loading, validation, version conversion, trust integration and save/publication.
- Pure resolver owns effective values and provenance.
- Runtime owns request captures, permission admission and approval evidence.
- Host executes the supplied tool configuration; it must not independently reload scoped settings and select a different account/interpreter.
- Notifications inform UI subscribers; correctness does not depend on event delivery.

Conceptual operations: `ensureLoaded(scope)`, `captureRequest(conversationId)`, `captureLaunch(parentId, profileName)`, `authorizeExecution(call)`, and `save(scope, expectedRevision, expectedDigest, patch)`.

User/project edits invalidate loaded dependent leads. Recompute in memory on next use; do not enumerate unopened conversations. Existing children's frozen preferences are not invalidated by preference edits; their current security-policy dependencies still are. Preparation spanning async work must capture one dependency generation vector or retry if a relevant dependency changes before publication. Include applied-profile, account configuration and trust dependencies, not just conversation revision.

## Save and external-edit behavior

Application save:

1. Serialize the whole read/check/write operation for the target file.
2. Validate the sparse document and resolved constraints; check expected revision and exact loaded source digest.
3. Atomically replace the file.
4. Publish the validated generation and invalidate dependents.
5. Acknowledge only after publication. Derived list-cache/event updates are recoverable work, not a second configuration authority.

If persistence fails, keep the old generation. If persistence succeeds but publication cannot complete, mark the scope unavailable and reload the authoritative file; do not keep executing a knowingly stale configuration or report a successful save prematurely.

**No configuration filesystem watchers, Rust watcher integration or per-turn polling.** External manual edits require application restart for guaranteed activation. Unloaded scopes naturally read current files at first use, but this is not a live-reload promise. Save-time digest checks detect stale application writes without rereading files on every tool call. An uncooperative external editor can still race between check and rename; do not promise cross-process compare-and-swap. The supported workflow is external edit followed by restart, not simultaneous competing writes.

Use existing explicit health Reload for an invalid document as a recovery operation only; this is not an automatic external-edit monitoring service.

## Tool execution admission

Every queued, initially supervised, approved and replayable recovered call reaches one final admission gate after asynchronous execution preparation. Immediately before dispatch, compare the current validated permission generation and evaluate current policy against the actual target/arguments. No asynchronous gap may separate the final generation check from dispatch admission.

An approval binds the call ID, normalized arguments, non-secret execution-target digest and relevant policy authority. These are recorded in the existing tool-call `supervision` JSON, not in tool arguments, because tools such as bash reject unknown arguments. A changed target or relevant authority invalidates the old approval: reevaluate, respect current denial, and request fresh approval if still needed. Approval of an earlier policy cannot bypass a later denial. Remembering a suggested rule preserves its original ruleset attribution but does not itself authorize execution under a changed ruleset.

Invalid applicable security configuration makes the call **configuration-blocked**: not failed, and never approvable as a bypass. Reuse the existing waiting lifecycle. The conversation status is `waiting` (parents see a waiting child, as today) with a configuration-blocked interaction that names the failing document and offers only **Retry** and **Cancel**, never Approve.

- Retry runs admission again. When the relevant scope health resolves after repair/reload, admission is retried automatically.
- Retry never auto-approves. If current policy still requires supervision, the call moves to an ordinary approval request.
- Cancel settles the call as cancelled with a configuration-blocked reason the model can read.
- Stop and replacement prompts keep their existing cancellation behaviour, and no timeout is added.

This replaces today's authorization-recovery approval in `permission.adapter.ts`. Represent it with the existing interaction JSON and nonterminal tool-call states; adding new database state columns requires separate review.

Runtime snapshots store account identity/configuration, never secrets. Resolve credentials through the credential service at execution; revoked/missing credentials must not silently select a different account.

## Restart and recovery

Do not persist executor captures. After restart, a not-yet-started call (`supervising`, `ready`, `awaiting_approval`, or a persisted approval resolution being replayed) is **re-captured** from the current validated configuration. It then passes the normal final admission gate:

- Current permission policy is evaluated again.
- If the re-captured non-secret execution-target digest (account, interpreter, shell) differs from the digest bound to an existing approval, that approval is invalid and a fresh approval is requested.
- If configuration is invalid, the call becomes configuration-blocked.

This matches today's behaviour of resuming these calls, adds target-bound approval, and does not interrupt queued work on every update. Preserve existing indeterminate handling for non-replay-safe calls that had already started running.

Plan approval is different from an external tool side effect: its target digest, submitted choices and transition identity are persisted in the existing review/lifecycle payload and single agent-document receipt. Reconcile an interrupted approved profile transition idempotently as specified in migration/recovery, without rerunning implementation automatically twice.

## Validation scenarios

Test change-during-stream behavior; final admission for approved/recovered/parallel calls; permission denial after approval; UI publication before acknowledgement; request-captured account configuration; launch-time revalidation; no parent copying; child freeze; source-generation invalidation; stale-save conflicts; restart re-capture with changed targets requiring fresh approval; configuration-blocked Retry/Cancel and automatic retry after repair. Do not claim no file IO at all: initial scope loading, skill/resource discovery and actual tool IO remain necessary; repeated configuration resolution itself is in memory.
