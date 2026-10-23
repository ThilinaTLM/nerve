# Scoped runtime wiring handoff

## Changes

Core requests, retries, compaction, previews, creation and child launch use the scoped configuration authority. SQL agent columns remain for Phase 5, not request/admission authority. Captures own tools, account definitions, model configuration references, interpreter, shell, normalized arguments and working directory; execution preparation resolves secrets. Restart recaptures targets.

The conversation channel consumes the new scoped read/save, creation-preference, effective-view, preview and profile-confirmation DTOs. Profile switches, reapply and plan approvals validate target digest/trust/applicability, requirements and expected configuration. Choices and snapshot commit in one CAS revision. Existing review decisions plus non-model lifecycle notifications and `lastTransition` reconcile interrupted transitions without replaying uncommitted decisions. Failed/stale approvals remain pending; accepted committed receipts fence further mutation until settlement. Lifecycle notifications publish through the core event stream.

Removed the obsolete profile/harness runtime composition. Legacy profile-definition editor/completion APIs are not adapters into the new authority; their old payloads are not translated. Client/editor migration remains separate work.

## Gate tests

Paths below are relative to `packages/`:

- Next-request model/reasoning: `conversation-core/src/runtime/request-freshness.test.ts` — `retry`, `overflow`, `capacity: refresh request config without replaying inputs or mutating an in-flight request`; also `runtime/prepared-request.test.ts`.
- Next-execution policy: `conversation-core/src/tool-calls/execution-admission.test.ts` — `current permission change affects next fresh and queued execution`.
- Approval versus later denial: same file — `later denial defeats approval without dispatch`.
- Restart/fresh approval: same file — `restart re-captures a changed target and requires fresh approval`.
- Invalid configuration: same file — `configuration blocked Retry is never approval and Cancel is readable cancellation`.
- Profile CAS/crash recovery/reapply: `workbench-server/src/infrastructure/configuration/agent-configuration/profile-transitions.test.ts`.
- Pending review and released locks: `conversation-core/src/runtime/plan-review-lifecycle.test.ts` — `plan stale failure...` and `plan persistence failure...`.

## Validation / remaining boundaries

Core/server targeted unit tests and package checks pass. No integration/browser suites, DDL, production-data operations or commits.

Focused validation remains blocked outside this scope: contracts' new `agent-configuration/operations.ts` violates the generic-filename policy. Separately, workbench-app checking reports 51 DTO-migration errors in nine files. Neither contracts nor UI was modified to bypass those boundaries. Focused validation is not fully green.
