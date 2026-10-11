# Profiles

Part of the [sub-agent profiles proposal](README.md).

## Files

A profile is one Markdown file. The frontmatter holds the configuration; the body holds the instructions. This follows the prompt suggestion format, because profiles carry free-form content that does not belong inside a JSON settings document.

| Level    | Location                                    | Notes                                 |
| -------- | ------------------------------------------- | ------------------------------------- |
| Built-in | Shipped with Nerve (`explore`, `developer`) | Read-only on disk                     |
| User     | `<NERVE_HOME>/agent/subagents/*.md`         | Created and edited from Settings      |
| Project  | `<project>/.nerve/subagents/*.md`           | Applied only when trusted (see below) |

The file name, without `.md`, is the profile name. It is lowercase letters, digits and single hyphens, at most 32 characters, and it is what the lead passes as `profile`.

```md
---
label: Explore
description: Read-only codebase and web research. Returns a report with paths and evidence.
enabled: true
model: lead # or "<provider>/<modelId>"
thinking: lead # or off | minimal | low | medium | high | xhigh | max
permission: read_only # read_only | autonomous
compaction: inherit # or { profile: balanced } / { profile: custom, triggerPercent: 75, keepRecentPercent: 15 }
tools: # delta from the lead's effective capability tools
  web_search: false
skills: none # inherit | none | { <skill-name>: true|false, ... }
---

You are a read-only researcher. Investigate the assignment; do not modify files.
End with a short report: summary, relevant files, evidence, open questions.
```

### Fields

| Field         | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`       | Display name. Defaults from the file name.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `description` | One line the lead sees in the `subagent_prompt` definition. Required; at most 200 characters, because it is paid for on every lead turn.                                                                                                                                                                                                                                                                                                                              |
| `enabled`     | File default. A Settings preference overrides it without editing the file.                                                                                                                                                                                                                                                                                                                                                                                            |
| `model`       | `lead` copies the lead's model at creation; otherwise a specific model.                                                                                                                                                                                                                                                                                                                                                                                               |
| `thinking`    | `lead` copies the lead's reasoning level at creation; otherwise a level.                                                                                                                                                                                                                                                                                                                                                                                              |
| `permission`  | `read_only` or `autonomous`. No other rule set is allowed, because any rule set with "ask" rules brings back human-in-the-loop.                                                                                                                                                                                                                                                                                                                                       |
| `compaction`  | `inherit` (no conversation override) or a compaction setting written as the child's conversation override.                                                                                                                                                                                                                                                                                                                                                            |
| `tools`       | Changes from the lead's effective capability tools: `<tool>: false` to remove, `true` to add one the lead has disabled, or an object to replace that tool's settings (for example `kroki_export: { url: ... }`). It uses the same keys and override shape as `capabilities.json`, into which it is written for the child. Core tools (`read`, `edit`, `write`, `bash`, ...) are always available and governed by the permission rule set, so they are not valid keys. |
| `skills`      | `inherit` (the lead's skills), `none`, or per-skill changes from the lead's set.                                                                                                                                                                                                                                                                                                                                                                                      |
| Body          | The instructions. It may be empty; at most 16 KB.                                                                                                                                                                                                                                                                                                                                                                                                                     |

Tools that are blocked for every sub-agent (`ask_user`, `plan_mode_*`, `subagent_*`) are not valid keys. A profile cannot enable them.

Invalid files are listed in Settings with their error and are not offered to the lead, matching prompt suggestions.

## Built-in profiles

| Field        | `explore`                                                                      | `developer`                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Description  | Read-only codebase and web research; returns a report with paths and evidence. | Implements, tests and fixes code in the shared worktree within an assigned scope.                                                |
| Permission   | `read_only`                                                                    | `autonomous`                                                                                                                     |
| Tools        | Same as lead                                                                   | Same as lead                                                                                                                     |
| Skills       | `none`                                                                         | `inherit`                                                                                                                        |
| Model        | `lead`                                                                         | `lead`                                                                                                                           |
| Compaction   | `inherit`                                                                      | `inherit`                                                                                                                        |
| Instructions | Research only; end with a short structured report.                             | Stay within the assigned scope; do not revert others' changes; run relevant tests; report changes, validation and anything left. |

Core tools cannot be toggled per profile: Explore's `read_only` permission already denies edits and writes, because the permission rule set governs core tools.

## Precedence and editing

- **Precedence:** project overrides user, and user overrides built-in, by name. The first definition found stays authoritative even when it is disabled, so a lower one does not reappear. Settings shows which entries are shadowed.
- **Editing a built-in** in Settings writes a user file with the same name. **Reset** deletes that file.
- **Duplicating** a profile writes a new user file with a new name.
- **Project profiles** are edited from Settings in project scope, which writes `<project>/.nerve/subagents/`. They can also be edited by hand and committed.

## Enablement

- **Per-profile switch:** stored in `<NERVE_HOME>/config/subagents.json` as `{ "enabled": { "<name>": boolean } }`. It overrides the file's `enabled` without rewriting the file, like `config/prompt-suggestions.json`.
- **Master switch:** the existing `subagents` capability. It keeps working at user, project and conversation level through `capabilities.json`.
- **No usable profile:** when no enabled and trusted profile exists, the sub-agent tools are hidden from the lead.

## Project trust

A project profile can grant `autonomous` permission and inject instructions. A cloned repository must not be able to do that silently. Project profiles therefore use content trust, like project capabilities:

- Each project profile file is a `TRUSTED_RESOURCE` bound to its content digest.
- Until it is trusted, it is listed in Settings with a **Trust** action and is not offered to the lead.
- Editing the file requires trust again. Edits made from Nerve's own Settings are trusted on save.

## Decided questions

| Question                   | Decision                                                        |
| -------------------------- | --------------------------------------------------------------- |
| Lead-visible profile names | Names (shorter and stable); labels are for people.              |
| Model availability         | Creation fails with a clear error; there is no silent fallback. |
