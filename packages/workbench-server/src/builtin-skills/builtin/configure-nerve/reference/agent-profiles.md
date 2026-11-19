# Agent profiles

A profile packages how an agent works: instructions plus settings for model, thinking, permissions, tools and skills.

- A **lead profile** shapes the agent the user talks to. The user picks it in the composer (or `/profile <name>`); agents cannot switch profiles.
- A **sub-agent profile** defines a teammate the lead can delegate to with `subagent_prompt`. The lead sees each one as `name: whenToUse` and picks by that line.
- `usableBy: "both"` makes one profile serve both roles; its settings must then fit the sub-agent limits below.

## Built-in profiles

| Name        | Role      | Purpose                                                                                  |
| ----------- | --------- | ---------------------------------------------------------------------------------------- |
| `coding`    | lead      | General work; the default for new conversations. No extra instructions or settings.      |
| `planning`  | lead      | Clarify, research and present a plan; requires the `planning` rule set and Plan Present. |
| `lead`      | lead      | Coordinates sub-agents; requires delegation.                                             |
| `forge`     | lead      | Configures and extends Nerve; requires the `configure-nerve` skill.                      |
| `explore`   | sub-agent | Read-only research; recommends the `read_only` rule set.                                 |
| `developer` | sub-agent | Autonomous implementation; recommends the `autonomous` rule set.                         |

A user or project file with the same name replaces a built-in completely. To adjust one, copy its intent into a new file rather than expecting a merge.

## File

User: `<home>/agent/agent-profiles/<name>.json`. Project: `<project>/.nerve/agent-profiles/<name>.json` (needs trust, see `reference/overview.md`). The file name is the profile `name` plus `.json`.

Project files carry an extra top-level `"version": 3`; user files have no `version`.

```json
{
  "version": 3,
  "schemaVersion": 1,
  "name": "reviewer",
  "label": "Reviewer",
  "whenToUse": "Review a finished change for bugs, missing tests and convention breaks; reports findings, edits nothing.",
  "usableBy": "subagent",
  "instructions": "Review the change you are given. Read the diff and the code around it, run the relevant tests, and report findings ordered by severity with file paths and line numbers. Do not edit files.",
  "recommendations": { "reasoningLevel": "high" },
  "requirements": { "permissionRuleSetId": "read_only" }
}
```

## Fields

Exact shape with every constraint: `reference/schemas/agent-profile.user.schema.json` and `reference/schemas/agent-profile.project.schema.json`. Validate a file against it before writing when you are unsure.

| Field             | Required | Value                                                                                                                                                                                                                                           |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`   | yes      | `1`                                                                                                                                                                                                                                             |
| `name`            | yes      | Lowercase letters and digits in hyphen-separated words, at most 32 characters; equals the file name.                                                                                                                                            |
| `label`           | no       | Display name, 1–80 characters, trimmed.                                                                                                                                                                                                         |
| `whenToUse`       | yes      | 1–200 characters, trimmed. For sub-agents this is what the lead chooses by: name the kind of task and the outcome.                                                                                                                              |
| `usableBy`        | yes      | `"lead"`, `"subagent"` or `"both"`.                                                                                                                                                                                                             |
| `instructions`    | yes      | Added to the agent's system prompt; at most 16 KiB. May be empty for a settings-only profile.                                                                                                                                                   |
| `enabled`         | no       | Sub-agent profiles only: `false` makes the profile unavailable to leads by default (the user can enable it per conversation). Default `true`.                                                                                                   |
| `recommendations` | no       | Settings object: values used unless the conversation chooses otherwise.                                                                                                                                                                         |
| `requirements`    | no       | Settings object: values enforced while the profile is applied; the user's own choice is kept underneath and returns when they switch profile.                                                                                                   |
| `extensions`      | no       | `{ "recommendations"?: {...}, "requirements"?: {...} }` keyed by extension id, each `{ "version": <settings version>, "enabled"?: boolean, "settings"?: {...} }`. Use only when the user asks for it, with the extension's documented settings. |

Unknown keys make the file invalid. The same setting may not appear in both `recommendations` and `requirements`.

Recommend when the profile has a sensible default the user may change (model, thinking). Require when the profile's purpose depends on it (a review profile that must stay read-only).

## Settings object

All fields optional; include only what the profile needs.

| Field                 | Value                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`               | `{ "provider": "<provider id>", "modelId": "<model id>" }`. Take both from the user's configured models (Settings → Models, or `<home>/config/providers.json`); never guess an id.                                                                                                                                                                                                                                  |
| `reasoningLevel`      | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. A level the model does not support is a conflict when required.                                                                                                                                                                                                                                                                                        |
| `permissionRuleSetId` | Id of a built-in or user rule set (`reference/permissions.md`).                                                                                                                                                                                                                                                                                                                                                     |
| `compaction`          | Any of `auto` (boolean), `profile` (`aggressive`, `balanced`, `conservative`, `custom`), `customTriggerPercent` (integer 60–90).                                                                                                                                                                                                                                                                                    |
| `retry`               | Any of `enabled` (boolean), `maxRetries` (integer ≥ 0), `baseDelayMs` (integer > 0).                                                                                                                                                                                                                                                                                                                                |
| `tools`               | Per tool, each entry non-empty: `python_exec` `{ enabled?, settings?: { interpreterPath? } }`; `web_search`, `web_fetch`, `quick_script` `{ enabled }`; `bash` `{ settings: { shellPath?, maxTimeoutMs? (1000–3600000), autoPromotion?: { enabled, afterMs } } }`. Lead only: `plan_present` `{ enabled?, settings?: { approvalProfile: <lead profile name> } }`, `subagents` `{ enabled }` (delegation on or off). |
| `skills`              | `{ "file"?: { "<skill>": true                                                                                                                                                                                                                                                                                                                                                                                       | false }, "nerve"?: {...}, "agentBrowser"?: {...} }`. Profiles cannot set `skills.defaults`. |
| `subagents`           | Lead only: per sub-agent profile name, `{ enabled?, model?, reasoningLevel? }` (non-empty) to turn a teammate on or off or give it a launch model.                                                                                                                                                                                                                                                                  |

Sub-agent profiles (`usableBy` `subagent` or `both`) may not use `tools.plan_present`, `tools.subagents` or `subagents`.

## How sub-agents become available

Every available profile usable as a sub-agent is offered to leads automatically (unless `enabled: false`), but only in conversations where delegation is on (`tools.subagents.enabled`, the Delegation switch in Capabilities, or a lead profile that requires it, like `lead`).

Rules every sub-agent follows regardless of its profile:

- It cannot ask the user, present plans, or delegate further.
- Its rule set must need no human approval: it must be enabled and contain no enabled `prompt` rule. Use `read_only`, `autonomous` or a user rule set built that way; `supervised` is rejected.
- Lead overlays and approvals do not apply to it.
- It freezes its configuration when created. Profile edits apply to sub-agents created afterwards, not to running ones.

## Writing good profiles

- Sub-agent `whenToUse`: specific enough that the lead picks it for the right tasks and not others ("Review a finished change…", not "Helps with code").
- Instructions: the role, how to approach the work, and what the final report must contain. Sub-agents do not see the lead's conversation, so instruct them to report findings with evidence (paths, commands run).
- Keep permissions as narrow as the purpose allows, and require them when the purpose depends on them.

## Applying changes

A conversation that already uses a profile keeps a snapshot of it. After editing a profile, the user applies the new version with **Apply updated profile** (or switches to the profile again). New conversations and new sub-agents use the current file after a reload (`reference/overview.md`).
