# Phase 4 server API handoff

All DTOs below are exported from `@nervekit/contracts/agent-configuration`. Profile/repair operations use the normal workbench operation transport; prompt/transition previews remain on the conversation channel.

## Profile editor

- `agentProfiles.list`: `ListScopedProfilesRequest/Result`.
- `agentProfiles.read`: `ReadScopedProfileRequest/Result`.
- `agentProfiles.save`: `SaveScopedProfileRequest`, `ProfileMutationResult`.
- `agentProfiles.delete` / `agentProfiles.reset`: `DeleteScopedProfileRequest`, `ProfileMutationResult`.

Scopes are `{scope:"user"}` or `{scope:"project", projectId}`. Definitions are complete schema-v1 `ProfileDefinition` objects. `ProfileCatalogEntry` exposes definition, origin, path/digest, trust, applicability, enablement, local-copy status and diagnostics. Disabled/untrusted definitions remain editable but are not applicable runtime selections.

Read returns `localDigest`; use it as `expectedDigest` when saving/deleting that scope's file. `"missing"` creates a complete local copy of an inherited definition. Delete/reset removes only the local copy, revealing the lower definition for future applications; existing conversation snapshots stay unchanged. Field-level “Use settings” removes that field from the complete definition and saves it. Invalid local files require confirmed repair, not destructive ordinary deletion.

## Trust and repair

`agentProfiles.trust` and `agentConfiguration.trust` use `ScopedTrustRequest/Result`. Pass a project `target` identifying `document:"profile"` (with name) or `document:"agent"`, `expectedDigest`, and `trusted:true/false` for grant/revoke. Changed bytes never retain trust automatically.

`agentConfiguration.repairPreview` uses `RepairPreviewRequest/Result`: target plus complete `replacement`, optionally a current `targetProfile` for conversation recovery. Preview returns candidate/source digests, version, changed JSON pointers and proposed effective resolution; it does not repair or dismiss health.

After explicit confirmation, send `RepairApplyRequest` (preview fields **excluding** `changedPaths` and `resolution`). `RepairApplyResult` includes protected original-byte backup/receipt paths and directory durability. Retry the same confirmation to reconcile an already committed receipt. Changed source/candidate bytes conflict. Repairs omit legacy `lastTransition` metadata and preserve valid applied snapshots unless an explicit validated profile target is selected; repair never grants trust.

## Previews and requirements

`ProfileTransitionPreview` adds `targetDefinition`, `changedFields` (values and provenance changes) and `unchangedRequirements`. Prompt previews exclude executor `tools`, satisfying the existing strict result DTO.

Ordinary CAS saves now preserve explicit choices beneath requirements, per specification. Requirements remain effective until removed/switched; plan-approval choices still reject conflicts.

## Explicit reload / manual edits

Ordinary reads, background retries and agent/trust invalidations do not poll policy files. Loaded permission documents are shared across conversations; `invalidate()` re-evaluates published memory, while `reload(paths)` explicitly activates disk changes. Application policy writes publish only their changed paths.

User Reload should call workbench `agentConfiguration.reload` with `{target:{document:"agent",scope}}` (also supports profile/name and conversation-defaults targets), then fetch the ordinary view. DTOs: `ReloadConfigurationRequest/Result`. It returns current scoped health, including failures; dismissal is not reload. A CAS conflict also authoritatively reloads the conflicting document before returning.

Explicit configuration-blocked Retry reloads its reported agent/policy dependencies before retrying admission. It never grants approval. Legacy user-permissions health Reload/Reset also refreshes that published permission document. No watchers were introduced.

Profile preview/apply uses target digest and configuration revision/digest CAS, without a profile transition journal. Manual requests need no transition ID; plan confirmations retain it only as approval correlation. Interrupted pending approvals require explicit reconfirmation, while completed approvals return their settled tool outcome. Profile save precedes atomic tool settlement and acceptance of one visible implementation user input.
