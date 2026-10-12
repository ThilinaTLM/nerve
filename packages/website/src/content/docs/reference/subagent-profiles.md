---
title: Sub-agent profile format
description: Markdown frontmatter, built-in profiles, precedence, enablement, and project trust.
sidebar:
  order: 6
---

A sub-agent profile describes a kind of sub-agent: its model, permission, tools, skills, compaction, and instructions. The lead picks a profile by name when it creates a sub-agent. The profile is applied once, at creation; editing or deleting it later does not change existing sub-agents.

User files live in `<NERVE_HOME>/agent/subagents/*.md` (normally `~/.nerve/agent/subagents/*.md`); project files live in `<project>/.nerve/subagents/*.md`. Manage them under **Settings → Sub-agents**.

```md
---
label: Explore
description: Read-only codebase and web research. Returns a report with paths and evidence.
model: lead
thinking: lead
permission: read_only
compaction: inherit
tools:
  web_search: false
skills: none
---

You are a read-only researcher. Investigate the assignment; do not modify files.
End with a short report: summary, relevant files, evidence, open questions.
```

## Name

The file name without `.md` is the profile name: lowercase letters, digits, and single hyphens, at most 32 characters. This is the value the lead passes as `profile`.

## Fields

- `label`: optional display name; defaults from the name.
- `description`: required, at most 200 characters. The lead sees it in the `subagent_prompt` definition on every turn, so keep it to one line.
- `enabled`: file default, enabled unless `false`. A switch in Settings overrides it without editing the file.
- `model`: `lead` copies the lead's model at creation; otherwise `<provider>/<modelId>`. If the model is unavailable, creation fails with an error instead of falling back.
- `thinking`: `lead` or a level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`).
- `permission`: `read_only` or `autonomous`. Other rule sets are not allowed for sub-agents, because any rule set that asks would bring a person back into the loop.
- `compaction`: `inherit`, or `{ profile, auto?, triggerPercent?, keepRecentPercent? }` written as the sub-agent's compaction override. `profile` is `aggressive`, `balanced`, `conservative`, or `custom`; the percentages apply to `custom`.
- `tools`: changes from the lead's effective tools, keyed by capability tool name. `false` removes a tool, `true` adds one the lead has disabled, and an object replaces that tool's settings. Core tools (`read`, `edit`, `bash`, and so on) are always available and governed by `permission`, so they are not valid keys. Human-in-the-loop and sub-agent tools cannot be enabled.
- `skills`: `inherit`, `none`, or a map of skill name to `true`/`false`, applied to the lead's skills.
- Body: the instructions, at most 16 KB, and optional. They become the sub-agent's `<agent_instructions>` section in its system prompt.

Unknown fields and invalid values make the file invalid. Invalid files are listed in Settings with their error and are never offered to the lead.

## Built-in profiles

- **`explore`**: read-only research that ends with a short structured report. Permission `read_only`, skills `none`.
- **`developer`**: implements, tests, and fixes code in the shared worktree within an assigned scope. Permission `autonomous`, skills inherited.

Both use the lead's model and thinking level. Editing a built-in in Settings saves a user file with the same name; deleting that file resets it.

## Precedence and enablement

Project overrides user, and user overrides built-in, by name. The first definition found stays authoritative even when disabled or untrusted, so a lower one does not reappear. Settings shows shadowed entries.

Per-profile switches are stored in `<NERVE_HOME>/config/subagents.json`. The **Sub-agents** tool group (user, project, or conversation level) remains the master switch. When no profile is enabled, valid, and trusted, the lead does not get the sub-agent tools.

## Project trust

A project profile can grant `autonomous` permission and inject instructions, so it is used only after you trust its exact content. Until then it appears in Settings with a **Trust** action and is not offered to the lead. Editing the file requires trust again; saving from Nerve's own Settings trusts the saved content.

:::caution
Review a project profile's permission and instructions before trusting it, as you would a project script.
:::
