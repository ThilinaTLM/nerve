# Configuration model

## Authority and scope

JSON owns persisted agent settings. SQLite owns conversation identity, relationships, execution history and lifecycle—not agent settings or a settings index. In-memory resolved settings are disposable. Conversation-list summaries may use a disposable JSON cache, never a second authority.

Configuration roots are:

| Scope        | Root                                           |
| ------------ | ---------------------------------------------- |
| User         | `<NERVE_HOME>/config/`                         |
| Project      | `<project>/.nerve/config/`                     |
| Conversation | `<NERVE_HOME>/data/conversations/<id>/config/` |

Use domain files. `agent.json` contains agent choices; a conversation's file also contains its applied profile contribution, allowing one atomic profile/model change. Other domains retain the ownership and paths in [the registry](domain-inventory.md).

## Preferences and profile priority

Resolve each setting independently, highest priority first:

1. Applied profile **requirement**.
2. Explicit conversation choice.
3. Applied profile **recommendation**.
4. Process-local command-line/environment agent-default override.
5. Project default.
6. User default.
7. Built-in default.

Command-line/environment agent-default overrides are not persisted and cannot defeat recommendations, conversation choices or requirements. Preserve their existing source attribution. Daemon startup precedence is a separate domain.

Missing preference fields inherit. Explicit false disables. Reset removes an override. Reading/resolving never writes inherited values back. Field-specific merge rules are normative in [schemas](schemas.md).

The profile editor has exactly three behaviors:

| Behavior       | Meaning                                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use settings   | No profile contribution. Includes explicit conversation choices, then project/user/built-in defaults.                                                                                                                                                            |
| Recommend      | Supplies a value unless the conversation explicitly chooses another.                                                                                                                                                                                             |
| Require (lock) | Temporarily controls the effective value; the underlying conversation choice is unchanged and its effective control is disabled. Switching to a profile that does not require the field lifts the lock and reveals the conversation choice or inherited default. |

There is no Set operation that writes profile values into conversation overrides, no Reset-to-settings profile operation, and no Same-as-parent mode. Application authorization restrictions remain authoritative regardless of preference precedence.

## Applied profile lifecycle

When selected, copy the validated profile's instructions, recommendations and requirements into conversation `agent.json`, with its name, source and digest. This is the **applied profile snapshot**: the role configuration that the conversation actually uses, not a backup or last-known-good recovery store.

Catalog edits/deletion do not change existing conversations. Offer **Apply updated profile** when a different valid definition is available. Explicit switch/reapply replaces the entire applied contribution, preserving conversation choices. New applications require current applicability, enablement and trust checks. A missing source does not invalidate a valid existing snapshot; an invalid stored snapshot blocks dependent execution.

User/project catalog files remain complete definitions, not another sparse inheritance ladder. Same-name project definitions replace user/built-in definitions; editing an inherited definition creates a complete local copy. Deleting a local copy exposes the lower definition for future application only. Display provenance and this copy-and-shadow behavior explicitly.

Profile instructions contribute to the built system prompt; they do not overwrite separately authored conversation instructions. Existing custom system-prompt behavior is preserved and clearly presented as an explicit conversation context override.

## Planning and approval

Planning requires the planning permission selection and `plan_present.enabled = true`. Coding contributes its own instructions and otherwise uses settings unless explicitly configured. Removing Planning reveals underlying permissions and tool selections; Coding does not silently grant write permission or force Plan Present off.

Planning enforcement is the planning permission ruleset plus Plan Present; there is no separate planning-mode branch. The v0.37.0 Python workspace-write guard tied to planning mode is intentionally not carried over. Planning guidance stays in the bundled profile's short instructions, which point to the planning skill; keep the token-efficient system prompt and tool descriptions from [System prompt, tool descriptions, and agent profiles](../system-prompt-and-agent-profiles.md) rather than restoring v0.37.0's hardcoded planning prompt text.

A plan review captures the target profile name and content digest. Approval previews the target's requirements and disables incompatible implementation model/reasoning choices. If the target changes, becomes unavailable/untrusted, or submitted choices conflict with requirements, reject the approval transition and request refreshed confirmation. Do not silently substitute another model.

Accepted implementation choices become explicit conversation overrides only for submitted fields. Omitted fields remain untouched. Commit those choices and the new applied profile in one document revision before implementation starts. Failed validation/persistence leaves the previous configuration and pending review intact. Event/transition crash recovery is specified in [migration and recovery](migration-and-recovery.md).

## Child agents

Lead and child settings share non-delegation field schemas. Only leads have available-sub-agent entries. Child schemas and execution guards reject delegation independently of tool advertisement; preserve existing child bans on `ask_user`, `plan_present` and sub-agent management tools.

An available-sub-agent entry selects a reusable profile by name and supports enablement plus **model/reasoning overrides only**. User → project → lead-conversation selection overrides merge independently of the child's own preferences. These invocation choices beat child recommendations but never requirements.

At creation, child preferences resolve from built-in/user/project/process defaults, its profile recommendations, explicit launch model/reasoning choices, and profile requirements. Never implicitly copy the parent's model, reasoning, permissions, tools or skills. There is no Same-as-parent option.

Use the latest validated launch selection when executing a new-child call, then capture the child's complete resolved underlying preferences and applied profile once. Preserve underlying values below requirements so requirements remain a separate contribution. Existing children resolve requirements over their frozen underlying preferences; recommendations are not reapplied above launch choices. An absent underlying model is allowed when requirements supply it. Filter role-prohibited resources before freezing. Later user/project preference changes and lead invocation changes do not affect existing children, including follow-ups. Profile switching/reapplication for children remains unsupported initially.

Child permission policy retains its existing independent ruleset and hard restrictions; do not introduce a new parent-permission ceiling or scoped overlay chain. Current authoritative ruleset definitions are still checked at execution. Frozen child preferences do not freeze revocable credentials or runtime authorization.

`usableBy: both` profiles must validate against the intersection of lead/child fields; they cannot contain delegation selections or child-banned tool entries. This preserves one profile catalog without recursive schemas.

## Source visibility

Show effective values with provenance: defaults, explicit conversation choice, recommendation, requirement or frozen child creation choice. Requirements must name the controlling profile. Reset removes only the editable choice; it cannot remove profile requirements.

Migrated per-conversation model, reasoning and permission values become ordinary explicit conversation choices. The composer shows them before every send, and Reset returns a field to inherited defaults. No separate legacy-origin label is kept.
