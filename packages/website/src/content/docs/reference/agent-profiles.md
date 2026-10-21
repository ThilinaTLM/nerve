---
title: Agent profiles
description: Scoped profiles for lead conversations and delegated work.
sidebar:
  order: 6
---

Agent profiles configure model, thinking, permission, compaction, tools, skills, and instructions. `usableBy` is `lead`, `subagent`, or `both`. The description explains **when to use this profile**.

## Built-ins and selection

- **Coding** (`coding`, lead): inherits model/thinking, sets permission to the settings default.
- **Planning** (`planning`, lead): inherits model/thinking, locks permission to `planning`, enables `plan_present`, and loads the planning skill.
- **Explore** (`explore`, subagent): read-only research, inherited model/thinking, no skills.
- **Developer** (`developer`, subagent): autonomous implementation, inherited model/thinking and skills.

Select a lead/both profile in the composer or use `/profile <name>`. `/plan` is shorthand for `/profile planning`. Agents cannot switch profiles. New conversations use `defaultAgentProfile`, resolved project → user → built-in `coding`; edit it in user or project Settings.

Plan approval switches to that default lead profile. Rejection leaves the current profile unchanged and ends the run; the agent waits for your next prompt.

## Scalar settings

Model, thinking, permission, and compaction each support:

| Choice  | JSON                                           | Effect                                                                                                                                   |
| ------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Inherit | `"inherit"`                                    | Lead: keep user changes, discard unchanged Set values from the previous profile. Sub-agent: copy the lead's effective value at creation. |
| Set     | A value or `"default"`                         | Write the resolved value when applying the profile; users can change it afterwards.                                                      |
| Lock    | `{ "lock": value }` or `{ "lock": "default" }` | Resolve every turn without overwriting stored configuration; disable the corresponding picker.                                           |

`default` resolves project → user → built-in settings. When switching to Inherit, an old inherited or locked field keeps its stored value. An old Set field resets to the settings default only if it still equals the old profile's resolved value. Selecting the same value explicitly is indistinguishable from leaving it unchanged.

Model values are `<provider>/<modelId>` strings; thinking uses supported thinking levels. Permission names identify rule sets; sub-agent safety restrictions still apply. Compaction values are `{ profile, auto?, triggerPercent? }`, with an integer trigger from 60–90 for custom settings. The permission picker shows every enabled rule set, not a profile-filtered subset.

Tools are capability-name maps to booleans or tool settings; skills are `inherit`, `none`, or a name-to-boolean map. These deltas apply to project/user capabilities for leads and to the lead's effective capabilities for children. Conversation toggles for keys changed by the destination profile are cleared on switching; other toggles survive. Permission policy remains authoritative.

Instructions are Markdown in a JSON string, rendered in `<instructions>`; `{{skill:name}}` references resolve skill content.

## Documents and layering

| Scope        | Location                                                          |
| ------------ | ----------------------------------------------------------------- |
| User         | `<NERVE_HOME>/config/agent-profiles.json`                         |
| Project      | `<project>/.nerve/config/agent-profiles.json`                     |
| Conversation | `<NERVE_HOME>/data/conversations/<id>/config/agent-profiles.json` |

Resolve built-in → user → project → conversation. Entries are sparse overrides; new names must resolve to complete profiles. Scalars replace individually; tool and per-skill maps merge by name. Explicit values stay pinned. Reset removes the local field or entry; mutation patches use `null` for removal.

```json
{
  "schemaVersion": 1,
  "profiles": {
    "planning": { "thinking": "high" },
    "developer": { "model": "inherit", "tools": { "web_search": false } }
  }
}
```

Names use lowercase letters, digits, and single hyphens, up to 32 characters. Labels are display names; descriptions are at most 200 characters; instructions are at most 16 KB. Unknown or unavailable tool/skill references are retained with diagnostics, not silently enabled. Unavailable models or incompatible thinking choices block application. Malformed documents are errors, not empty configuration.

Project documents require trust in their exact content. External edits invalidate trust. Editing one entry in an untrusted document does not trust untouched entries; review and explicitly trust the whole document. Conversation overrides cannot bypass project trust. Profile trust is distinct from existing skill-loading policy.

## Editing and effective time

**Settings → Agent profiles** edits user/project profiles, including usability and Inherit/Set/Lock, with reset, copy, origins, and diagnostics. Conversation capability controls support local profile overrides without changing reusable defaults.

For leads, instructions, capability deltas, and Locks are resolved each turn. Set edits apply only when switching into the profile again. A deleted or disabled active profile falls back to the default lead profile with a notice.

For sub-agents, profiles remain creation-time templates. The child stores its creation profile name read-only; changing or deleting that profile does not reconfigure existing children. Change an existing child's supported controls directly. The delegation capability remains the master switch, and sub-agents cannot delegate, ask the user, or present plans.

Storage migration renames existing profile documents, converts `lead` to `inherit`, and marks existing custom entries `usableBy: "subagent"`. There is no runtime loader for old profile filenames.
