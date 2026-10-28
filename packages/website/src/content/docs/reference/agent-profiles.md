---
title: Agent profiles
description: Scoped preferences, profile recommendations and requirements, and delegated work.
sidebar:
  order: 6
---

Agent profiles contribute instructions and settings for model, thinking, permissions, compaction, retry, tools and skills. `usableBy` is `lead`, `subagent`, or `both`; `whenToUse` tells the agent when to use the profile.

## Selection and built-ins

- **Coding** (`coding`, lead): general-purpose work; no additional instructions or settings requirements.
- **Planning** (`planning`, lead): requires planning permissions and Plan Present with Coding as the approval profile; instructions include clarification, research, and implementation planning.
- **Lead** (`lead`, lead): requires delegation; instructions include requirements ownership, coordination, and evidence-based review. Available subagent profiles inherit settings.
- **Explore** (`explore`, subagent): read-only research.
- **Developer** (`developer`, subagent): autonomous implementation.

Select a lead/both profile in the composer or use `/profile <name>`. `/plan` selects Planning. Agents cannot switch profiles. New conversations use `defaultAgentProfile`, resolved project → user → built-in Coding. There is no remember-last-selection option.

Plan approval previews the target profile's requirements and commits accepted model/thinking choices with the profile switch. Incompatible choices are blocked; a changed or unavailable target requires refreshed confirmation. Leaving Planning reveals underlying choices: Coding does not grant write permission or force Plan Present off.

## Use settings, Recommend, Require

| Behavior         | Effect                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------- |
| **Use settings** | No profile contribution; use conversation choices and inherited defaults.              |
| **Recommend**    | Supply a value unless the conversation explicitly chooses another.                     |
| **Require**      | Temporarily control a value and disable its control, preserving the underlying choice. |

Priority is requirement → conversation choice → recommendation → process default → project → user → built-in. Switching profiles preserves conversation choices. **Reset removes an editable override and inherits**; it does not copy a default into the conversation or remove a requirement. Source labels distinguish defaults, conversation choices, recommendations, requirements and frozen child choices. Required values identify the controlling profile.

Model and reasoning are separate settings; the picker saves them together. Reasoning inherited from a different source can be fitted to the model with a visible adjustment. Incompatible required reasoning is a conflict, not silently changed. Tool settings are typed; profiles support individual skill booleans. Ordinary settings also support source defaults (`file`, `nerve`, `agentBrowser`). Permission policy remains authoritative.

## Applied profile snapshots

Applying a profile captures its instructions, recommendations and requirements, with its name, source and digest, in the conversation's `agent.json`. Editing, disabling or deleting the catalog definition does not change a valid applied snapshot. Use **Apply updated profile** to capture a changed definition explicitly. Switching/reapplying preserves conversation overrides and local prompt context.

Project definitions require trust in their exact bytes. External edits invalidate trust for new applications. Trusting a profile does not independently trust skill content or grant credentials.

## Files and editing

| Purpose                         | User                                             | Project                                              |
| ------------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| Agent preferences               | `<NERVE_HOME>/config/agent.json`                 | `<project>/.nerve/config/agent.json`                 |
| Start profile and picker models | `<NERVE_HOME>/config/conversation-defaults.json` | `<project>/.nerve/config/conversation-defaults.json` |
| Profile definitions             | `<NERVE_HOME>/data/agent-profiles/<name>.json`   | `<project>/.nerve/agent-profiles/<name>.json`        |

Conversation preferences, the applied snapshot and conversation-only `context` live in `<NERVE_HOME>/data/conversations/<id>/config/agent.json`. There is no conversation profile catalog. Permission overlays remain separate `config/permissions.json` documents; provider/integration catalogs and credentials remain user-owned.

Catalog files are complete definitions: a same-name project definition replaces the entire user/built-in definition. Editing an inherited profile creates a complete local copy. Deleting that copy exposes the lower definition for future applications only.

**Settings → Agent profiles** edits user/project definitions using Use settings/Recommend/Require. For example, a complete user profile can recommend thinking while requiring read-only permissions:

```json
{
  "schemaVersion": 1,
  "name": "research",
  "whenToUse": "Inspect and explain without changing files.",
  "usableBy": "lead",
  "instructions": "Research the question and cite relevant files.",
  "recommendations": { "reasoningLevel": "high" },
  "requirements": { "permissionRuleSetId": "read_only" }
}
```

## Children and activation

Child agents resolve their own defaults and profile; they do not copy the lead's effective model, permissions, tools or skills. **Capabilities → Sub-agents** controls availability and optional launch model/thinking overrides. These beat recommendations, never requirements. A child captures its complete underlying preferences and applied profile once; later default/profile/launch edits do not affect follow-ups. Existing child profile switching/reapplication is unsupported. Children cannot delegate, ask the user or present plans; live authorization still applies.

UI saves update validated configuration directly. **There are no file watchers:** manual edits need a restart for guaranteed activation, or an explicit Reload/Retry re-read. New requests capture current settings; tool execution checks current permissions even after approval waits.

Malformed files and unavailable required references appear in configuration health. Review repair previews before confirming; damaged sources are backed up, not silently replaced, and dismissing a notice does not repair it. Invalid security configuration puts affected calls in **configuration-blocked** waiting with **Retry/Cancel**. Repair the cause, then Retry to re-read it; approval cannot bypass the block.

Profile `whenToUse` is required, trimmed text (at most 200 characters). Agents see profiles as `name: whenToUse`; the slug `name` is used for delegation and the optional `label` is the display name. Profiles can override individual skills only, not skill-source defaults (`skills.defaults`). Skill availability otherwise follows the normal built-in → user → project → conversation layers.
