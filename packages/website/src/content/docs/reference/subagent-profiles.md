---
title: Sub-agent profile format
description: Scoped JSON profiles, sparse overrides, diagnostics, enablement, and project trust.
sidebar:
  order: 6
---

:::note[Implementation status]
This reference describes the current scoped JSON implementation; owning contracts and host/UI adapters are authoritative.
:::

A sub-agent profile describes a kind of sub-agent: its model, thinking level, permission, tools, skills, compaction, and instructions. The lead picks a profile by name when creating a child. **Profiles are creation-time templates, not live bindings:** editing, disabling, or deleting one affects future children only.

## Documents and scopes

Each writable scope has one document containing all its local entries, including instructions and enabled state:

| Scope        | Location                                                                         |
| ------------ | -------------------------------------------------------------------------------- |
| User         | `<NERVE_HOME>/config/subagents.json` (normally `~/.nerve/config/subagents.json`) |
| Project      | `<project>/.nerve/config/subagents.json`                                         |
| Conversation | `<NERVE_HOME>/data/conversations/<id>/config/subagents.json`                     |

Built-in defaults are shipped with Nerve. Conversation documents are deleted with their conversation. There are no separate Markdown profile files or enablement preference files in this format.

This example sparsely overrides built-in profiles; it is not a complete definition for a new name:

```json
{
  "schemaVersion": 1,
  "profiles": {
    "developer": {
      "enabled": true,
      "model": "lead",
      "thinking": "high",
      "tools": { "web_search": false }
    },
    "explore": { "enabled": false }
  }
}
```

## Names and fields

A key in `profiles` is the name passed as `profile`: lowercase letters, digits, and single hyphens, at most 32 characters. An inherited entry can override only selected fields; a new name must resolve to a valid complete profile.

- `label`: display name, defaulting from the name.
- `description`: at most 200 characters. The lead sees it on every turn, so keep it to one line.
- `enabled`: per-profile switch in this scope. `false` explicitly disables; a higher scope can re-enable it.
- `model`: `lead` copies the lead's current model at creation; otherwise `<provider>/<modelId>`. An unavailable explicit choice blocks creation rather than falling back.
- `thinking`: `lead` or `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Known incompatibility with the selected model blocks creation rather than silently downgrading.
- `permission`: `read_only` or `autonomous`. Rule sets that ask a person are not allowed.
- `compaction`: `inherit`, or `{ profile, auto?, triggerPercent?, keepRecentPercent? }`. `profile` is `aggressive`, `balanced`, `conservative`, or `custom`; percentages apply to `custom`.
- `tools`: capability tool names mapped to `true`, `false`, or tool settings. Applied to the lead's effective tools at creation. Core tools such as `read`, `edit`, and `bash` are governed by permission, not profile toggles. Human-in-the-loop and delegation tools cannot be enabled.
- `skills`: `inherit`, `none`, or a map of skill name to `true`/`false`, applied to the lead's selection.
- `instructions`: optional JSON string containing Markdown, at most 16 KB. It becomes the child's `<agent_instructions>` section; there is no separate Markdown body.

Unknown fields and structurally invalid values are errors. Unknown tool/skill references are retained for portability, subject to the diagnostics below.

## Resolution, reset, and copy

Resolve by name through **built-in → user → project → conversation**. Missing fields inherit from lower profile layers. Scalars and instructions replace individually; tool and per-skill maps merge by name. A skills mode such as `none` replaces the inherited mode; structured compaction replaces as a whole.

An explicit value remains **pinned**, even when equal to the inherited value. Reset removes the local field or entry and restores inheritance. Mutation patches may use `null` for removal; saved documents omit reset fields. `model: "lead"` and `thinking: "lead"` mean copy the parent's current values at creation, not inherit a lower profile's choice.

**Copy to this scope** writes all effective fields under the same name, pinning them against lower-layer changes. Duplicating under another name creates an independent profile. Removing a local entry reveals inherited settings, but invalid or untrusted entries must not silently fall back to a lower same-name profile.

The **Sub-agents** tool group remains the master switch. Per-profile enablement cannot bypass it or runtime restrictions. Disabling or deleting the last usable profile prevents future creations but leaves prompt follow-ups, status and stop available for existing children; the prompt schema omits `profile`, and new-child creation fails. With no usable profiles and no existing children, the tools are hidden. Turning the master capability off removes the entire group even when children exist.

## Built-in profiles

- **`explore`**: read-only research ending with a structured report; permission `read_only`, skills `none`.
- **`developer`**: implementation, tests, and fixes in the shared worktree within an assigned scope; permission `autonomous`, skills inherited.

Both use `model: "lead"` and `thinking: "lead"`; neither assumes a provider. Editing them writes sparse overrides in the selected scope; reset removes those overrides.

## Availability and trust

- **Warnings:** enabled tools that are unknown, missing, or unconfigured, and skills that are missing or not loadable under existing resource policy, remain saved but are not enabled or loaded on the child. An otherwise usable profile can run with reduced capabilities. Unknown names remain visible in diagnostics even if absent from pickers.
- **Blocking diagnostics:** an unavailable explicit model or known model/thinking mismatch prevents creation. Choose a configured model and supported thinking level; there is no silent fallback.
- **Validation errors:** malformed JSON, unsupported document versions, invalid entries, forbidden tools, or forbidden permissions are errors, not capability warnings. A malformed document is not treated as empty or overwritten on save. An invalid entry does not hide unrelated valid entries.

Availability is rechecked at creation. Saving does not discard unavailable references; runtime security and provider restrictions still apply. Profile trust applies only to the project `subagents.json` document, not to skill content. The resource loader has no separate skill trust system; profile availability adds no independent skill trust feature or database gate and preserves existing loader security semantics. It does not currently detect “found but untrusted” skills. If a resource-specific trust policy exists later, the same diagnostics can report its loading restrictions.

Project configuration can inject instructions and grant autonomous permission. Its exact document content must be trusted before affected profiles are usable. External edits require trust again. Editing, toggling or resetting one entry in an untrusted imported project `subagents.json` does not trust the entire document or activate untouched entries: explicitly trust the whole document after review. Nerve-authored updates can be trusted automatically only for missing/new documents or documents whose exact previous content was already trusted. Conversation overrides cannot bypass project trust.

:::caution
Review the project document's permissions and instructions before trusting it, as you would a project script.
:::

## Legacy conversion and manual review

Home migration covers user profiles and projects registered in that home, not every project directory on disk. An unregistered old project opened later needs explicit conversion to canonical `.nerve/config/subagents.json`. There is no runtime legacy Markdown loader.

Conflicts between legacy and canonical configuration, malformed documents, and incompatible legacy capability shadowing stop migration with an actionable error. Relevant sources are preserved until explicitly resolved; migration must not guess enabled state or delete project sources before a safe replacement is verified. Legacy same-name user/project tool and skill maps replaced whole definitions; sparse JSON maps merge, so extra inherited keys can change capabilities. Those cases require a manual capability decision before retrying migration.

Development homes with an earlier draft of step 0001 already applied require a baseline rebuild/copy: extending that step does not rerun an applied ledger entry. This is a dev-only limitation, not an additional released migration path.

## Settings and conversation controls

**Settings → Sub-agents** provides the full user/project editor: name, label, description, instructions, enabled state, model, thinking, permission, tools, skills, and compaction. It includes copy-to-scope, duplicate-under-new-name, reset, field origins, and diagnostics. Project edits stay in project configuration rather than user preferences.

The **Capabilities → Sub-agents** tab in a lead conversation provides **enabled, model, and thinking** overrides, inherited values, per-field reset, and diagnostics. You can configure these before sending the first message, just like tools and skills. Changes stay with the draft and are saved before the first run starts; user and project defaults are unchanged. The same document supports all fields, but full instructions and capability editing stays in Settings initially.

For usage limits or cost, override the profile in the lead conversation to select a fallback for **new** children. For an **existing** child, open that child's view and change its own model/thinking controls directly. A follow-up to its existing name uses that child and its current configuration; it neither reapplies the profile nor creates a replacement. Changing the lead's model also does not change already-created children.
