---
title: Skills and project resources
description: Give agents reusable instructions with AGENTS.md, SYSTEM.md, and skills, and turn skills on or off.
sidebar:
  order: 12
---

Add instructions that agents follow in every run: project guidance in `AGENTS.md`, and reusable skills for specific tasks.

## Add project guidance

Put an `AGENTS.md` file in your project, or in a parent folder, to describe conventions, commands, and constraints. Nerve also reads a global `AGENTS.md` from your Nerve home. To add text to the system prompt for one project, use `.nerve/APPEND_SYSTEM.md`.

You can review and edit these in a project's **Settings → Instructions files** page. Changes apply from the next run; a request already sent isn't rewritten.

## Add a skill

A skill is a Markdown file with a name and a description, which the agent reads only when it is relevant.

1. Create a folder such as `.agents/skills/release-notes/` in your project. Use `.nerve/skills/` for Nerve-only skills, or `~/.agents/skills/` to use a skill in every project.
2. Add a `SKILL.md` file with a `description`. The folder name, in lowercase with hyphens, is the skill's name.
3. Open **Settings → Skills** to confirm Nerve found it.

To get started quickly, enable the built-in **skill-creator** skill and ask the agent to create a skill for you.

If two skills share a name, the project's wins over your own. The [resource reference](/reference/resources/) lists the exact order and discovery rules.

## Turn skills on or off

Open **Settings → Skills** to see each skill's source and switch it on or off without deleting its file.

- Skills you write are on by default.
- Built-in Nerve skills and Agent Browser guidance are off by default and add nothing to the agent's instructions until you enable them.

Use **User** scope to set defaults for all projects and **Project** scope to share overrides with your team. Source labels explain why a value is on or off, and **Reset** removes an override so the value is inherited again. A profile can also turn skills on or off for conversations that use it.

## Good to know

- Skills with invalid files are skipped and shown with a diagnostic in Settings.
- Set `disable-model-invocation: true` in a skill to keep it available when you apply it explicitly, without advertising it to the agent.
- Manual edits to configuration files need a restart or an explicit Reload; Settings changes apply from the next run.
- Sub-agents keep the skills they started with and don't pick up later changes.
- Older `.pi` folders are not loaded. Move their contents to `.nerve/` and `.agents/skills/`.

:::caution
Skills and project instruction files are instructions for the model. A repository can ask for tools, credentials, network calls, or destructive actions. Review unfamiliar resources before raising permissions above supervised.
:::

## Next steps

- [Resource and skill precedence](/reference/resources/)
- [Agent Browser integration](/integrations/agent-browser/)
- [Security model](/operations/security/)
