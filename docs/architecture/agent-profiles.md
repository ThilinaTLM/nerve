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

## Modes and switching

Every scalar (model, thinking, permission, compaction), skills, and each tool entry use one mode vocabulary:

- **Use settings** (field omitted): keep the conversation's current value.
- **Reset to settings** (`"settings"`): write the application settings value (project → user, ignoring conversation overrides). For tools and skills it removes the conversation override, so the entry follows settings again.
- **Same as lead** (`"lead"`): copy the lead's effective value at sub-agent creation; only for sub-agent-usable profiles.
- **Set** (`{ "set": value }`): write the value; the user can change it afterwards.
- **Lock** (`{ "lock": value }`): write the value and reject user mutation while this applied profile is active.

Applying a profile materializes these values into ordinary conversation settings and captures name, instructions and locks in `applied-agent-profile.json`. A switch replaces the previous locks. Use settings keeps whatever the previous profile wrote, so a profile that must undo another profile's values declares them with Reset to settings. Model/thinking chosen during plan approval are preserved over Set and Reset to settings, but not over Lock.

`conversation.setAgentProfile` calls core's `setAgentProfile`, which delegates policy to `AgentProfilePort.applyProfile` and persists its config, optional compaction override, capability overrides and applied snapshot. It publishes existing config/changed notifications and applicable harness/capability invalidations. Sub-agent switches are rejected.

## Lead lifecycle and planning

Store the active name in `conversations.agent_profile TEXT NOT NULL`, without a CHECK. This repurposes the old mode column, not a new column. New conversations select `defaultAgentProfile` (project → user → `coding`) and apply Set values to settings defaults.

The composer lists lead/both profiles; `/profile <name>` switches and `/plan` selects `planning`. There is no agent-facing switch tool. Sub-agent views show their creation profile read-only.

Built-ins:

| Profile     | Usable by | Behavior                                                                                                          |
| ----------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| `coding`    | lead      | Permission and `plan_present` Reset to settings; everything else Use settings; final summary instruction.         |
| `planning`  | lead      | Permission Lock planning; Set `plan_present` on (approval target `coding`); instructions load the planning skill. |
| `explore`   | subagent  | Inherited model/thinking; read-only research; skills none.                                                        |
| `developer` | subagent  | Inherited model/thinking; autonomous implementation; inherited skills.                                            |

All built-ins inherit compaction. `plan_present` is a normal capability tool, disabled by default. Its turn-time description includes the absolute plan-storage directory. The planning skill directs read-only research, requirement decisions through `ask_user`, a complete plan file, and submission for review. Approval switches through the same core path to the `plan_present` approval profile captured when the plan was presented. Rejection preserves the current profile and ends the run. Plan storage, review interaction, and the `plans` permission root are unchanged.

Turns read the applied snapshot, not the template. Template edits apply on the next switch into the profile, never automatically over user choices. Deleted/disabled active profiles fall back to the default lead profile with a notice.

## Sub-agent snapshots

Resolve against the lead's current effective values at creation. Inherit copies those values; Set and Lock both apply at creation. Materialize config, instructions, capability deltas, and compaction from the same snapshot. The stored profile name is provenance, not a live binding: edits affect future children only; follow-ups keep the existing child's configuration. Runtime sub-agent restrictions remain authoritative.

## Migration

Extend the single unreleased migration step: rename `subagents.json` to `agent-profiles.json`, convert scalar `lead` to `inherit`, add `usableBy: "subagent"` to custom entries, rewrite trusted-resource kinds to `agent_profile`, remove obsolete fields and compatible-mode metadata, rename stored `plan_mode_present` references, and repurpose the conversation column. Do not retain runtime aliases or legacy loaders. See [storage migrations](migrations.md).
