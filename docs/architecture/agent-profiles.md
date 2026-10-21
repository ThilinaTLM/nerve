# Agent profiles

Agent profiles unify lead instructions/capabilities and sub-agent creation templates. Contracts in `@nervekit/contracts/agent-profiles` own schemas, built-ins, and pure layering. The host owns document IO, trust, availability, default resolution, and switch policy; conversation core owns persistence and turn lifecycle through `AgentProfilePort`.

## Documents and resolution

One `schemaVersion: 1` document with a `profiles` map exists at each writable scope:

- User: `<NERVE_HOME>/config/agent-profiles.json`
- Project: `<project>/.nerve/config/agent-profiles.json`
- Conversation: `<NERVE_HOME>/data/conversations/<id>/config/agent-profiles.json`

Resolve built-in → user → trusted project → conversation. Entries are sparse: scalars replace individually, tool/per-skill maps merge by name, and instructions replace as a whole. Explicit values remain pinned; resetting removes local fields (`null` in mutation patches). New names must resolve to complete profiles. Missing documents mean no overrides; malformed/unreadable documents are errors, not empty configuration.

Fields: label, description (when to use the profile), enabled, `usableBy: "lead" | "subagent" | "both"`, model, thinking, permission, compaction, tools, skills, instructions. Instructions render in `<instructions>` with `{{skill:name}}` expansion. Capability deltas do not grant permission or bypass runtime restrictions.

Project content requires exact-document trust; external edits invalidate it. Editing a single untrusted entry must not activate untouched entries. Conversation overrides cannot bypass trust. Unknown/unavailable tool and skill references remain saved with diagnostics; unavailable explicit models and incompatible thinking block application. Profile trust does not introduce a separate skill trust system.

## Scalars and switching

Model, thinking, permission and compaction use `AgentProfileScalar<T>`:

- **Inherit**: `"inherit"`.
- **Set**: a value or `"default"`.
- **Lock**: `{ "lock": value }` or `{ "lock": "default" }`.

Defaults resolve project → user → built-in. Set writes configuration on application; Lock resolves effective values each turn without persisting them. Only Lock disables a picker. Permission pickers show all enabled rule sets; there is no compatible-mode filtering.

For a switch from P to Q, Set always writes Q's resolved value; Lock writes nothing. If Q inherits, keep the stored value when P inherited or locked. If P set the field, reset to the settings default only when the stored value still equals P's resolved value; otherwise preserve the user's change. Explicitly selecting the same value is indistinguishable from leaving it unchanged.

Drop conversation capability toggles for keys Q changes and keep the rest. No additional profile history is stored.

`conversation.setAgentProfile` calls core's `setAgentProfile`, which delegates policy to `agentProfiles.switchProfile` and persists its config, optional compaction override, and capability overrides. It publishes existing config/changed notifications and applicable harness/capability invalidations. Sub-agent switches are rejected. Core overlays `resolveLockedScalars` during turn preparation without persisting Locks.

## Lead lifecycle and planning

Store the active name in `conversations.agent_profile TEXT NOT NULL`, without a CHECK. This repurposes the old mode column, not a new column. New conversations select `defaultAgentProfile` (project → user → `coding`) and apply Set values to settings defaults.

The composer lists lead/both profiles; `/profile <name>` switches and `/plan` selects `planning`. There is no agent-facing switch tool. Sub-agent views show their creation profile read-only.

Built-ins:

| Profile     | Usable by | Behavior                                                                                                        |
| ----------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| `coding`    | lead      | Model/thinking inherit; permission Set default; final changes/validation/limits summary.                        |
| `planning`  | lead      | Model/thinking inherit; permission Lock planning; enables `plan_present`; instructions load the planning skill. |
| `explore`   | subagent  | Inherited model/thinking; read-only research; skills none.                                                      |
| `developer` | subagent  | Inherited model/thinking; autonomous implementation; inherited skills.                                          |

All built-ins inherit compaction. `plan_present` is a normal capability tool, disabled by default. Its turn-time description includes the absolute plan-storage directory. The planning skill directs read-only research, requirement decisions through `ask_user`, a complete plan file, and submission for review. Approval calls the same core switch path with the profile omitted to select the default lead profile. Rejection preserves the current profile and ends the run. Plan storage, review interaction, and the `plans` permission root are unchanged.

Lead instructions, tools/skills and Locks resolve each turn. Set edits apply on the next switch into the profile, never automatically over user choices. Deleted/disabled active profiles fall back to the default lead profile with a notice.

## Sub-agent snapshots

Resolve against the lead's current effective values at creation. Inherit copies those values; Set and Lock both apply at creation. Materialize config, instructions, capability deltas, and compaction from the same snapshot. The stored profile name is provenance, not a live binding: edits affect future children only; follow-ups keep the existing child's configuration. Runtime sub-agent restrictions remain authoritative.

## Migration

Extend the single unreleased migration step: rename `subagents.json` to `agent-profiles.json`, convert scalar `lead` to `inherit`, add `usableBy: "subagent"` to custom entries, rewrite trusted-resource kinds to `agent_profile`, remove obsolete fields and compatible-mode metadata, rename stored `plan_mode_present` references, and repurpose the conversation column. Do not retain runtime aliases or legacy loaders. See [storage migrations](migrations.md).
