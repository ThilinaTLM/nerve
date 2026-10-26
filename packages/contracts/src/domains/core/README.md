# Tool admission and configuration-blocked interactions

Import the following from `@nervekit/contracts/core`.

## Approval evidence

- `toolApprovalBindingSchema` / `ToolApprovalBinding`: strict `{toolCallId, toolName, argumentsDigest, executionTargetDigest, policyAuthorityDigest}`. All digests are lowercase SHA-256 hex. `Supervision.approval?: ToolApprovalBinding` records a **granted** approval, not an approval request. Pending supervision has no grant. The surrounding tool-call parser rejects a binding for another call ID/tool name.
- `toolApprovalBindingMatches(approved: ToolApprovalBinding | undefined, current: ToolApprovalBinding): boolean`: exact binding comparison; any changed call, tool, arguments, target or relevant authority invalidates the old grant. Missing evidence is not a matching grant. This function is **not authorization**: a current denial always wins.
- `configurationGenerationVectorSchema` / `ConfigurationGenerationVector`: dependency-key → nonnegative safe-integer process-local generation. Keys are owned by the host's configuration/account/trust/discovery/policy sources.
- `toolAdmissionEvidenceSchema` / `ToolAdmissionEvidence`: strict `{binding, requestGenerations, policyGenerations}` for the transient core/host seam. Do not put this object, executor captures or credentials into persisted tool-call JSON.

The host owns normalization, canonical serialization and hashing. `argumentsDigest` must cover the tool's normalized/canonical arguments, not unvalidated provider syntax. `executionTargetDigest` must cover the **actual prepared non-secret execution identity/configuration**, including the selected account identity and non-secret account configuration, resolved interpreter/shell, working directory, and other relevant execution-target settings. Bind tool name separately as above. Never hash/persist a credential as target configuration; credential validity is checked live and missing/revoked credentials must not select a replacement account. `policyAuthorityDigest` binds the relevant ruleset/policy authority, including applicable trust and hard role restrictions; do not use a process-local generation number as a durable authority digest.

When recording a grant, use the binding of the target/arguments actually presented for confirmation, not a freshly recomputed target silently substituted at resolution time. Core/host orchestration must reject stale confirmation after a target/authority change and request refreshed approval.

After asynchronous preparation, the final gate must synchronously verify current policy generations and evaluate current policy against that target/arguments immediately before dispatch, without an asynchronous gap. A matching stored grant cannot bypass denial or invalid security configuration. Re-capture not-yet-started calls after restart and compare freshly constructed bindings; executor captures are not restart authority.

## Configuration-blocked waiting

- `configurationBlockedRequestSchema` / `ConfigurationBlockedRequest`: strict `{diagnostics: ConfigurationDiagnostic[]}` with at least one redacted scoped/document/path diagnostic (the existing agent-configuration diagnostic contract).
- `configurationBlockedResolutionSchema` / `ConfigurationBlockedResolution`: strict `{kind:"configuration_blocked", decision:"retry"|"cancel"}`. No approve, persist-scope or policy-override fields.
- `configurationBlockedInteractionSchema` / `ConfigurationBlockedInteraction`: strict `{kind:"configuration_blocked", request, resolution?, resolutionRequestId?}`.

These variants are included in `Interaction` and `InteractionResolution`. **Use the existing `interaction.resolve` operation**, with its existing toolCallId and idempotent resolutionRequestId; no new operation/capability is introduced. The operation envelope is strict. Existing `conversation.toolCall` notifications and snapshots carry the pending interaction/receipt; existing tool-call-response events can carry the final resolution and supervision evidence.

An unresolved blocked interaction uses existing tool-call state **`awaiting_input`**; `toolCallSchema` enforces this. The SQL `tool_call.state` CHECK already permits that value, and the interaction/supervision columns already accept JSON. No enum, state column, CHECK or migration change is required. A stored retry receipt may remain while the call moves back into supervision/readmission. Retry re-evaluates admission and never means approval; if current policy requests approval, publish a normal approval interaction. Health recovery also triggers re-evaluation, not automatic approval. Cancel settles as cancelled with a configuration-blocked reason visible to the model. Stop/replacement semantics are unchanged and no timeout is added. The core/host runtime owners implement those transitions; these contracts do not dispatch tools or perform recovery themselves.
