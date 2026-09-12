# Run and execution lifecycle

> **Status: Proposed implementation contract — pending architecture approval.** Part of the [unified conversation timeline proposal](README.md). The overview defines the shared status and normative language; this document owns the detailed contract for its topic.

Owns checkpoints, barriers, child ownership, tools, provider requests, and recovery actions. Read [timeline identity and transitions](timeline.md) first. [Restore and deletion](durable-recovery.md) add lifecycle fences that these operations must honor.

## Checkpoints, wait groups, and applicability

### Immutable checkpoint

#### INV-CHECKPOINT-01

This invariant owns immutable checkpoint evidence and the [applicability predicate](#applicability-predicate). Conversation membership comes from [INV-AUTH-01](timeline.md#inv-auth-01), and control-head behavior comes from [INV-HEAD-01](timeline.md#inv-head-01).

A checkpoint MUST name:

- checkpoint schema version, identity, conversation/run/agent identity;
- capture revision and transition identity (diagnostic ordering/provenance);
- anchor entry ID, nullable at root, and selection epoch;
- run execution generation and execution phase;
- immutable snapshot reference and integrity hash, including compatibility version;
- pending tool/interaction identities and their input/policy fingerprints, represented directly or by a bounded immutable manifest;
- wait-group identity and model-context recipe/version or required opaque provider state reference.

A checkpoint MUST NOT own transcript membership through a copied entry list, transcript cursor, or harness leaf. Provider continuation state may be necessary execution state; it is not evidence of branch membership. Unsupported or corrupt required snapshot versions produce recovery-required/non-resumable outcomes, not a best-effort replay of external work.

### Wait-group control

#### INV-BARRIER-01

This invariant owns member dispositions, the state machine below, and one-time continuation entitlement. A wait group is the bounded set of tool calls, interactions, and registered child-agent tasks produced by one committed execution phase. Its immutable membership is separate from its current transactional status. The run control record tracks its canonical continuation head, resolved/terminal member states, and whether continuation has already been consumed.

A run can have executing members and pending human decisions simultaneously. Resolving one approval may authorize that member immediately; model continuation waits until **all** members are settled with barrier-satisfying dispositions (including proven non-execution), with required results attached. Any indeterminate member blocks automatic continuation. An empty group can continue immediately. Limits MUST be enforced before committing an oversized group; implementations may reject the response with an explicit run error rather than partially draft it.

Barrier evaluation uses canonical member dispositions, not provider formatting. Successful and known-failed executed members require one unique canonical result attachment. Denied or never-dispatched cancelled members require a committed `not_executed` disposition with reason, which is sufficient without inventing tool output; a model adapter may render a synthetic denial/cancellation message referencing that fact. A known failure may continue as an error result. `outcome_unknown`, `result_unavailable`, and detached outcomes never satisfy an active group's barrier. Cancelling the whole run closes continuation rather than satisfying its barrier. Result/disposition commitment and the member's terminal/barrier update MUST be atomic.

### Wait-group member state machine

A member's **execution outcome**, **attachment disposition**, and **barrier contribution** are separate facts. In this contract, a member is settled for an active group only when it contributes to the barrier; a terminal execution attempt alone is insufficient. A closed group's members no longer have continuation rights, regardless of their underlying effects.

| Member state                                  | Legal forward transitions                                                                                                                                                                                                                                                                       | Active-group barrier                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Drafted                                       | Awaiting approval, authorized, or denied/cancelled with proof of non-dispatch                                                                                                                                                                                                                   | No                                                             |
| Awaiting approval                             | Authorized, or denied/cancelled as `not_executed`                                                                                                                                                                                                                                               | No                                                             |
| Authorized                                    | Executing; awaiting a fresh decision if policy changed; cancelled as `not_executed` only before proven dispatch                                                                                                                                                                                 | No                                                             |
| Executing                                     | Succeeded/known-failed with attached result; `outcome_unknown`; `result_unavailable`; `not_executed` only with conclusive non-dispatch evidence                                                                                                                                                 | No while executing                                             |
| Succeeded or known-failed, result attached    | Settled; duplicate outcome is replay, not a new transition                                                                                                                                                                                                                                      | Yes                                                            |
| Denied or cancelled, `not_executed` committed | Settled; no fabricated result bytes required                                                                                                                                                                                                                                                    | Yes                                                            |
| `outcome_unknown`                             | Reconcile to a conclusive attached outcome, known outcome with unavailable output, or proven `not_executed`; admit a safe retry only under [external-effect contract](execution.md#external-effects-cancellation-and-artifacts); otherwise remain recovery-required or close with abandoned run | No; member is unresolved even if an attempt has stopped        |
| `result_unavailable`                          | Verified output recovery to attached success/failure, or authorized/executing through fresh-observation recovery admission under INV-EFFECT-01; otherwise remain recovery-required or close with abandoned run                                                                                  | No; execution is conclusive/terminal but member is not settled |
| Closed/detached                               | Retain or reconcile late evidence without reviving the group                                                                                                                                                                                                                                    | Never; owning group is closed                                  |

Any unsettled member may become effectively closed when its run/selection is fenced; batch materialization does not delay closure. A cancellation request for an executing member is not proof of `not_executed`. Multiple attempts are allowed only under the execution/retry contract; a recovery claim alone does not reset an unknown member to authorized. Conclusive non-dispatch plus current authorization may admit it to authorized again; an admitted repeat-safe observation or contractually replay-safe effect under [INV-EFFECT-01](#inv-effect-01) may admit it to executing under a new fenced attempt. Record the proof and recovery admission; neither path creates a barrier-satisfying disposition until its actual result or explicit non-execution decision commits. Local retries that preserve a member's unresolved execution phase are not new members. Once settled, a member cannot be reopened for another effect in the same group.

Child-agent members use this same barrier model: authorization permits dispatching the child task, executing means awaiting its terminal result, and only a validated parent attachment or proven non-execution settles the active parent member. Child-local completion and parent-member settlement are distinct commits where necessary; reconciliation bridges them without duplicate attachment. Their ownership and cancellation rules follow below.

### Applicability predicate

An interaction resolution is applicable only if:

1. Its conversation, run generation, and selection epoch match current canonical execution control.
2. The run has not been fenced, terminalized, or placed in a recovery-required state incompatible with that resolution.
3. The interaction is an unresolved member of the current wait group, its bound inputs and requested authority have not changed, and current policy/trust dependencies have been validated or compatibly re-evaluated under [file-authoritative permissions](permissions.md).
4. The checkpoint anchor is a canonical ancestor of the group's continuation head, with live ownership satisfying [INV-HEAD-01](timeline.md#inv-head-01).
5. Advances since capture are limited to the owning group's results/resolutions and explicitly compatible context-boundary transitions. They are not unrelated user/model entries or another run's attachments.

This predicate belongs to [INV-CHECKPOINT-01](#inv-checkpoint-01). Its incremental checks also satisfy the history-independent cost requirement in [INV-PERF-01](validation.md#inv-perf-01), rather than reassembling transcript lists. Integrity validation may use ancestry indexes or offline scans.

A changed revision alone causes CAS revalidation, **not supersession**. Selection/generation changes or incompatible history cause semantic supersession. A later checkpoint may reference the earlier immutable snapshot plus recorded member resolutions; do not mutate an old checkpoint to pretend it captured later state.

Fencing takes effect immediately through authoritative control reads. Pending interactions whose owning generation is closed are not actionable even if their individual stored status still awaits batch cleanup. APIs MUST compute effective status from the fence; clients must reconcile optimistic state after rejected actions. Cleanup durably materializes cancelled/superseded member statuses in bounded batches.

### Agent concurrency and child lifecycle

#### INV-AGENT-01

Unrelated conversations and child-agent conversations progress independently. Multiple tools may execute outside transactions concurrently. Parent attachments follow the foreground ownership rule in [INV-HEAD-01](timeline.md#inv-head-01). Agent/task telemetry need not claim that path. An agent result intended for the parent transcript attaches through a registered member of the owner's wait group or becomes a queued input for later acceptance. Arbitrary background append to an active run's path is forbidden.

A child conversation owns its own execution lifecycle. **Parent cancellation, abandonment, navigation, or deletion fences attachment to the parent; it does not implicitly cancel an already-dispatched child conversation.** The parent group closes immediately rather than waiting for the child. Work provably not dispatched cannot start under the closed parent authorization. An already-running child may finish independently, with its terminal outcome recorded in its own conversation.

For a live applicable parent group, the child terminal outcome and verified output are reconciled into one parent result attachment and settled member state. A child failure/cancellation after execution requires a conclusive failure/cancellation result, not a `not_executed` fiction. Unknown child-side effects or unavailable required output keep that parent member recovery-required. After parent fencing, any parent-side notification becomes detached evidence while retention permits, never an automatic queued message on a new branch. A user may explicitly submit a new input referencing the child result later.

Cancelling children is a separate explicit operation with durable identities and per-child outcomes. It may accompany a user-facing cancel-tree action, but its bounded/asynchronous fan-out cannot weaken the immediate parent fence or claim that remote effects were undone. Deleting a parent does not cascade-delete an independently owned child conversation.

This establishes deterministic committed order, not a scheduler-independent order of racing tool completions. Their result entries follow successful commit order; projections preserve tool-call identity so providers can render valid tool-result associations regardless of completion order.

## External effects, cancellation, and artifacts

### Tool retry capabilities and effect identity

#### INV-EFFECT-01

Every tool operation MUST have an explicit, versioned replay-safety declaration on the shared tool contract. Its serializable schema and persisted evidence belong in `packages/contracts`; `packages/tools` definitions/adapters supply capabilities and execute against them. The server owns durable identity allocation, authorization, claims, and recovery admission. Tool risk/permission traits, names, HTTP verbs and transient-error retry flags are not substitutes for replay capability.

| Capability                       | Meaning after possible dispatch                                                                                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Safe-repeat observation          | Repeating the same validated operation causes no material external mutation, and a fresh observation is acceptable for uncommitted output. Requeue under current authorization and a new fenced attempt; returned content may differ               |
| Contractually replay-safe effect | Repeat only within a declared precondition/idempotency contract for the same logical effect. Declare external key scope/encoding, retention window and reconciliation limits where relevant; expired or unprovable guarantees do not permit replay |
| Non-repeatable or unknown        | No automatic invocation after possible dispatch without conclusive non-dispatch or newly established replay-safety evidence. Reconcile, expose uncertainty, or abandon                                                                             |

An absent, unknown or incompatible capability defaults to non-repeatable/unknown. Declared observation safety avoids forcing ordinary verified read operations into an unknown-effect workflow, but a read-risk label alone cannot grant it. A tool with input-dependent effects must classify the validated operation conservatively before dispatch; if it cannot prove an observational mode, use its strongest possible effects. Reading a status endpoint and mutating a remote task are not interchangeable merely because one tool implements both.

Reconciliation support is independent of repeatability: a tool may be able to query a conclusive outcome without being safe to invoke again. Merely writing the same desired value does not prove idempotence in the presence of concurrent external changes. Capability declarations need corresponding behavior/proof before automatic replay is enabled.

Allocate a stable logical effect identity durably before first dispatch, bound to the tool/capability version, normalized input fingerprint, owner and applicable external account/target. It differs from command identity and attempt/claim identity. Adapters may deterministically encode it into an external deduplication key under a versioned contract; they MUST NOT derive identity solely from arguments, mint a fresh effect key on retry/restore, or alias two distinct authorized calls. All attempts of one logical effect retain that identity. A new intentional effect requires new identity and authorization.

Persist the evaluated capability and scope evidence with the authorized operation. Upgrade/recovery must validate that the current adapter honors that recorded contract; a newer broader declaration cannot silently expand old replay rights. Legacy work may receive a capability only through source-version-specific proof under [INV-MIGRATE-02](migration.md#inv-migrate-02), not by copying today's risk metadata. Provider key expiry or changed ownership makes prior idempotency evidence inapplicable.

Capabilities permit retry evaluation, not unconditional scheduling. Every admitted attempt still needs current permission, run applicability and [INV-CLAIM-01](#inv-claim-01); retries are bounded and never overwrite committed output. A fresh repeat-safe observation is recorded as a new attempt/observation for unresolved output, not described as recovery of the exact lost bytes. Once output has been canonically committed, missing/corrupt bytes remain an integrity problem under [INV-ARTIFACT-01](#inv-artifact-01), not permission to replace history with a later read.

### Execution protocol

#### INV-CLAIM-01

This invariant owns claim/lease fencing for tool and provider attempts. [INV-EFFECT-01](#inv-effect-01) decides replay safety; claim ownership alone does not.

1. Commit validated proposal and policy decision/interaction.
2. Commit authorization bound to tool input, run generation, and stable effect identity.
3. Claim one execution attempt durably with a fencing token; check authorization/fence immediately before dispatch.
4. Invoke outside the transaction. Cancellation after dispatch cannot revoke an already-performed effect.
5. Prepare and verify complete required payloads outside the transaction.
6. Commit outcome, attachment disposition, tool state, and continuation consequences atomically.

Worker settlement MUST atomically compare the current execution incarnation, attempt ID, logical phase/effect identity, current claim token, attempt revision, and settleable state (active with no committed terminal disposition). The claim must be unexpired at transactional validation. Successful settlement consumes that attempt's settlement right once; identical command replay returns its receipt, and conflicting outcomes fail closed. Expired/revoked workers can submit evidence to recovery but cannot directly settle. Recovery atomically acquires a new reconciliation token and records evidence under it; acquiring that token does not authorize another external invocation. A conclusive later reconciliation appends a resolution of earlier unknown evidence rather than rewriting it.

Attempt claims are created/renewed/replaced transactionally with their owning execution state. Lifecycle work and its attempt share or reference one authoritative claim token/generation; independent scheduler/domain leases cannot compete for execution authority. Redelivered work retains the logical operation identity and does not itself authorize retry. Domain capability determines whether a fresh claim may dispatch again.

Run/selection fences and execution-claim tokens are separate: cancellation removes attachment/continuation rights but need not revoke an otherwise valid worker's right to report a detached outcome. Recovery token replacement does revoke direct settlement rights. Internal fencing prevents stale workers from committing conflicting outcomes. It cannot stop an external service that does not honor fencing or idempotency. Lease expiration alone is never proof that the former worker did not perform the effect.

Retry admissibility follows [INV-EFFECT-01](#inv-effect-01); evidence and user exits follow [INV-RECOVERY-01](#inv-recovery-01). A claim is not a third source of replay permission.

### Recovery actions and exit conditions

#### INV-RECOVERY-01

Recovery actions MUST have stable identities and evidence. A user may acknowledge an unknown outcome, provide reconciliation evidence, or abandon the uncertain run and authorize separate new work after an explicit duplicate-effect warning. Acknowledgement is not proof of success. Resolution never silently rewrites historical attempt evidence.

Recovery-required is a durable pause with explicit actions, not a permanently disabled button. APIs and UI MUST distinguish the following outcomes:

| Action                             | Required evidence and effect                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reconcile outcome                  | Query an authoritative external operation locator/idempotency record or validate equivalent tool-specific evidence binding effect identity, inputs, and terminal outcome. A user assertion alone does not prove execution                                                                                                          |
| Recover complete output            | Restore attachment bytes only, never proof of execution/success: retrieve the original artifact/external output or supplied bytes matching recorded digest/size and ownership. With no expected digest, require a tool-specific validator proving association and completeness; execution outcome must be independently conclusive |
| Supply replacement information     | Record it explicitly as user-supplied information, not as original tool output or proof of an external effect. It does not satisfy the uncertain member's barrier                                                                                                                                                                  |
| Repeat a safe observation          | Admit only under INV-EFFECT-01 and current applicability; preserve the earlier attempt and settle a fresh observation, not reconstructed original bytes                                                                                                                                                                            |
| Leave pending                      | Retain evidence and the recovery-required state; no automatic retry or continuation                                                                                                                                                                                                                                                |
| Abandon uncertain work             | Acknowledge that effects may have occurred, close/fence the owning run and its continuation rights, and terminalize the wait group without satisfying its continuation barrier                                                                                                                                                     |
| Start separately after abandonment | Create a new run and, if needed, a new explicitly authorized effect identity after a duplicate-effect warning. Do not reuse abandonment as authorization to repeat the old effect                                                                                                                                                  |

External reconciliation evidence MUST be obtained through an authorized query or independently verifiable record, authenticated to the expected provider/service and tenant/account, and matched to the original effect key or operation locator, normalized inputs, and ownership. A plausible response from another account or an unverified pasted operation ID is not conclusive. Record the evidence source and validation method without persisting credentials. Provider-side effect recovery follows the same rule.

A safe-repeat observation is also an explicit recovery path under [INV-EFFECT-01](#inv-effect-01). Before dispatch, a recovery-admission transition revalidates the same applicability, input, policy and capability predicates used for recovery attachment, records the cause of retry, and moves the unresolved member from `outcome_unknown`/`result_unavailable` to authorized/executing under a new attempt and claim. Preserve the prior attempt's unavailable/unknown evidence; do not rewrite it as never executed. The admission clears only the block preventing this member's retry, not its barrier or any other member's uncertainty. It cannot replace an existing canonical result attachment.

Settlement of that new observation may attach one fresh result for the still-unsettled member, linked to both its new attempt and the recovery admission. The old observation's bytes/outcome are not fabricated; an older late worker cannot win the new claim or create a second attachment. Normal barrier checks then determine continuation. This is not verified restoration of the original bytes or unconditional revival of the run.

Conclusive reconciliation, verified output recovery, or settlement of an admitted fresh observation MAY unblock the **same still-applicable run**. A dedicated recovery transition checks current conversation/selection epoch, run generation, group membership, anchor/continuation head, attempt reconciliation token, and required snapshot compatibility. Unlike ordinary continuation, this transition may clear the recovery-required state once its cause is resolved. It atomically records evidence, the unique result attachment, member disposition, new snapshot, and any newly available continuation entitlement. It does not mutate old checkpoints or erase earlier unknown evidence. Other unresolved members still block the barrier.

If the run was cancelled, abandoned, superseded, or has lost applicability, conclusive evidence is recorded as a detached outcome only. It cannot revive the run. Supplied output never establishes success unless execution outcome is independently conclusive; known success with unverifiable replacement bytes remains `result_unavailable`. An acknowledged unknown outcome or explicit abandonment never counts as successful/failed tool output for automatic continuation. Repair may resume a run; abandonment terminates it.

A tool may be shown as normally completed **with an available conversation result** only when outcome and attachment agree in the same transition. Exceptions are explicit dispositions: detached, result unavailable, or outcome unknown. APIs and UI must preserve this distinction rather than flattening all interrupted calls to failed.

### Provider-request phases and retry

#### INV-PROVIDER-01

This invariant owns model-phase lifecycle and retry eligibility. Shared lease/settlement fencing is owned by [INV-CLAIM-01](#inv-claim-01), and provider-executed external effects also obey [INV-EFFECT-01](#inv-effect-01). Pure generation retains its distinct repeatability contract below.

#### Phase, attempt, and scheduled-work state

A **phase** is one logical model request with at most one committed response. An **attempt** is one possible provider invocation for that phase. A **claim** is the time-bounded, fenced authority of a worker to execute/settle that attempt. **Lifecycle work** is the durable scheduling record that makes a phase/attempt discoverable; it is neither a second request identity nor independent execution permission.

Creating a run MUST atomically create its first provider-phase obligation and schedulable preparation work. Until its canonical source/context and immutable request are prepared, that phase is `preparing` and cannot dispatch. Preparation failure pauses/fails the run explicitly; it cannot leave an active owner with no recoverable next work. Every later continuation atomically creates its next phase obligation in the same way. Frozen request preparation advances the phase to `ready` without consuming another continuation entitlement.

| Phase state       | Allowed progress                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preparing         | Ready after request/snapshot validation, recovery-required if required state is unavailable, or closed by cancellation/terminal failure               |
| Ready             | Claim a new attempt and become active, or close when fenced                                                                                           |
| Active            | Prepare a complete response; retry under the declared capability after fencing the old attempt; require recovery on uncertainty; or close when fenced |
| Response prepared | Commit once under a valid settlement/recovery claim, enter recovery-required if payload/provenance cannot be validated, or close when fenced          |
| Recovery-required | Explicit recovery admission to ready/response-prepared only with the required proof, or close on abandonment/terminalization                          |
| Committed         | Terminal for the phase; response replay is idempotent and later model work uses a new phase                                                           |
| Closed            | Terminal without response attachment; late evidence cannot reopen it                                                                                  |

Provider lifecycle work applies the single claim-authority rule in [INV-CLAIM-01](#inv-claim-01); phase retry eligibility remains local to INV-PROVIDER-01.

On lease loss, scheduling evaluates phase retry/reconciliation under [INV-CLAIM-01](#inv-claim-01) rather than treating expiry as completion. Normal response commitment terminalizes its attempt/work atomically with the phase; cancellation/abandonment closes uncommitted phases, with bounded cleanup.

A prepared response belongs to its phase and originating attempt, with immutable request/response identities, completeness evidence and artifact ownership. Its verified manifest must be durably recorded to qualify as recoverable prepared output; an orphan file alone does not qualify. Worker lease loss does not expire a durable prepared response. Pin it while its phase is unresolved/recoverable; on commitment the canonical attachment assumes retention, and on closure unreferenced payloads become eligible for bounded cleanup under the normal artifact rules. Temporary preparations without a durable manifest use the staging-expiry protocol. Losing required pinned bytes enters recovery-required rather than silently falling back to regeneration.

Every model request, including the first request of a run, MUST have a durable provider-phase identity distinct from its attempts. Store its conversation/run/selection binding, execution incarnation (see [restore protocol](durable-recovery.md#restore-and-rollback-execution-protocol)), source head and context recipe, bounded immutable request reference/hash, provider/model/configuration identity, required opaque-state snapshot, and declared retry capability. Consuming a continuation entitlement MUST atomically create that phase obligation and schedulable next work; dispatch eligibility waits for validated immutable request preparation. A crash cannot consume the entitlement without leaving recoverable next work.

Before dispatch, claim a provider attempt with a current owner/token and generation. The provider call occurs outside the transaction. Commit at most one response for a phase, together with its assistant entries, proposed local tool calls, and resulting snapshot/run state. Tool proposals from partial streams or uncommitted responses MUST NOT authorize local tool execution. Streamed content is provisional until response commitment.

| Interruption/capability                                                                                                | Retry contract                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase is ready with a validated request, but no dispatch claim was issued, with valid uninterrupted execution evidence | Reclaim and dispatch after current applicability checks; no new continuation entitlement is needed                                                                                           |
| Claimed/possibly dispatched stateless generation, with no provider-side effects other than generation/billing          | May repeat the frozen request under a new fenced attempt of the same phase, with bounded retry limits; duplicate charges and different output are explicitly possible                        |
| Complete response durably prepared but not attached                                                                    | Validate its identity, completeness, provenance and current claim/recovery ownership, then commit it once if still applicable; do not regenerate merely because the transcript lacks it      |
| Response lost before commit for safely repeatable generation                                                           | Regeneration is permitted; there is no promise to reproduce lost streamed/uncommitted text                                                                                                   |
| Stateful provider session, opaque continuation mutation, or provider-executed tools/effects                            | Retry only with a provider-supported idempotency/reconciliation contract or proof of non-dispatch. Otherwise interrupt as recovery-required; do not classify it as ordinary generation retry |

Retry eligibility is an explicit provider capability, never inferred from a missing assistant entry or a generic network error. Reusing a logical provider operation's external idempotency key must follow its documented semantics. A required opaque pre-request snapshot must be intact and compatible; merely possessing its bytes does not prove the remote session can be rewound. Unsupported state cannot be rebuilt by asking a model to approximate it. Moving to a new provider/session/context is a separate explicit restart, not an unnoticed retry of the frozen phase.

Response settlement applies [INV-CLAIM-01](#inv-claim-01) and additionally validates current run generation/selection, immutable request/context/source binding, and an unset committed-response identity in the same transaction. Only one response can commit for the phase; arrival timing does not supersede claim authority. Stale responses may be retained as bounded diagnostics, but never attach or dispatch their proposed tools. Recovery may adopt a prepared response only under a new reconciliation claim with validated provenance; it cannot grant a stale worker settlement rights.

After restore, retrying a quarantined provider phase requires a durable **recovery admission** that links its original phase identity/request and historical binding to the fresh incarnation and currently validated run generation/selection. This admission appends evidence; it does not rewrite the phase's original snapshot or request. New attempts use that admission's binding/token, and settlement validates it as well as the unchanged phase identity and unset committed-response identity. No old claim is reused. If recovery needs different request/context/provider state, close the old phase and create separately authorized new work instead of admitting it as a retry.

The [restore protocol](durable-recovery.md#restore-and-rollback-execution-protocol) overrides local pre-dispatch evidence: an older backup cannot prove a provider request was never issued after the backup. Ordinary generation may still be safely repeatable under its declared capability, whereas provider-side effects require external reconciliation. Cancellation or navigation fences the phase; no automatic retry on a different active branch is allowed.

### Cancellation and late outcomes

This subsection applies [INV-CLAIM-01](#inv-claim-01) and [INV-HEAD-01](timeline.md#inv-head-01) to late evidence; it does not define another fence. Cancellation atomically closes the run generation and its continuation rights. Not-yet-dispatched work becomes effectively cancelled immediately; running work receives best-effort cancellation outside the transaction. Bounded cleanup avoids touching every child in the hot commit.

If result settlement wins the transaction race first, its attachment remains historical truth and cancellation follows it. If cancellation/navigation wins first, a late result records its actual attempt outcome and payload with a detached disposition. Its disposition follows [INV-RECOVERY-01](#inv-recovery-01), without reviving attachment rights. Historical activity views can display that detached outcome using its canonical provenance. A future explicit adoption operation would require its own reviewed semantics; it is not implicit retry behavior.

### Artifact publication

#### INV-ARTIFACT-01

Complete payload availability, provenance, ownership and retention MUST remain verifiable independently of projections. The following preparation/reference rules elaborate this invariant; actual payload encodings and staging layouts are implementation choices.

- Payloads use immutable managed identities and portable relative locators, never unvalidated absolute paths into a developer's home.
- Preparation registers a bounded staging/ownership record, writes bytes atomically, and verifies digest and size before a transition advertises them as available. Durable file finalization must precede the SQLite reference commit under the supported filesystem durability model.
- Active preparation is protected from garbage collection by an explicit lease/state. A commit revalidates that prepared ownership is still valid; cleanup cannot race a successfully pinned reference.
- Detached payloads are owned by their source conversation and execution attempt. Their authoritative outcome reference pins them just as an entry reference does; run terminalization is not garbage-collection permission.
- A crash before reference commit may leave an orphan. Cleanup removes expired, unreferenced preparations in bounded batches. It never removes a referenced payload or a live preparation.
- A crash after reference commit must leave a valid reference and finalized file. Subsequent missing/corrupt content is an integrity failure surfaced explicitly, not an empty tool result.
- Large inputs, assistant content, summaries, snapshots, and tool results may all use artifact references. Inline metadata and payload budgets MUST be enforced before commit; truncation is only a projection policy, never replacement of complete canonical bytes.

## Worked examples

These traces illustrate the owning invariants above; they are not additional normative definitions or a prescribed test harness.

### Two approvals from one turn

1. At revision 40, run R owns head H and selection epoch 3. Wait group G contains tools A and B; their checkpoints reference H/G/R's generation.
2. Approval A commits at 41 and authorizes A. B remains actionable because G, epoch, and generation are unchanged.
3. A's result attaches at 42 as child HA of H and advances G's continuation head to HA.
4. Approval B submitted against revision 40 receives CAS conflict. Reloading finds the same applicable G, so retry of the same semantic command commits at 43. No transcript-list comparison occurs.
5. B's result attaches at 44 as child HB of HA. The group becomes terminal and grants one continuation entitlement; duplicate workers cannot start two continuations.

Resolving B first yields the opposite valid commit order, not a stale A. Denial contributes a terminal member outcome/result according to the model projection policy. An unknown effect blocks the barrier.

### Navigation away and back

A pending approval belongs to epoch 3. Selecting another entry commits epoch 4 and fences its run. Returning to the original tip commits epoch 5. The old approval is still superseded even though the visible tip matches its old anchor. Its retry returns a durable terminal outcome, never new authorization.

### Cancellation races completion

Both commands expect revision 60. If settlement commits first, result entry E is durable at 61 and cancellation must reload before fencing at 62. If cancellation commits first, settlement reloads, preserves the attempt's observed outcome with detached disposition, and does not append E to active history. Neither ordering pretends the external effect was undone.

### Repeat-safe observation after interruption

A tool operation has a validated safe-repeat observation declaration, but its process exits before committing output. Recovery rechecks applicability and permission, fences the old attempt, and performs a fresh observation under the same logical operation identity. If the file changed, the new output is identified as a new observation, not the lost original. No unknown-effect decision is required merely because a read result was lost. A previously committed result is never replaced this way. This illustrates [INV-EFFECT-01](#inv-effect-01).

### Crash after external success

Authorization and attempt are durable, external success occurs, then the process exits before outcome commit. Recovery queries by external locator/idempotency key where supported. Otherwise it records `outcome_unknown`; missing transcript output is not a reason to dispatch again. A late worker with an obsolete claim cannot overwrite a reconciled outcome.

### Artifact preparation interruption

Crash before file finalization: expired staging data can be cleaned; no available timeline reference exists. Crash after finalization but before database commit: retain/reconcile prepared data or collect it after its protection expires. Crash after commit: reference and file must validate. Known side-effect success with irrecoverable missing output becomes result-unavailable, not automatic re-execution.

### Recovery unblocks or closes a run

Tool T in group G is unknown after interruption. An authoritative external record conclusively identifies its outcome and complete result. If G's run, selection, continuation head and snapshot are still applicable, one recovery transition attaches the result, resolves T, and releases continuation only when every member is satisfied. If the user abandoned the run first, the same evidence records a detached outcome. Pasted text without proof does not resolve T; abandonment never counts as a completed barrier member.

### Provider response lost or late

Consuming a continuation entitlement creates phase P and preparation work, then the process exits before any claim. Ordinary recovery can finish/validate P's preparation and claim P rather than consume another entitlement. If dispatch may have occurred and the response was lost, a declared repeatable stateless generation may be retried with possible duplicate cost/different output; a stateful provider-side action cannot. Replacing attempt A with B fences A. A late response from A cannot append content or launch tools, even if it arrives before B's response. A durably committed response to P prevents any second response commitment.
