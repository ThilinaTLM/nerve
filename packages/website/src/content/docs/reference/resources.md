---
title: Resource and skill precedence
description: Exact locations and precedence for AGENTS.md, APPEND_SYSTEM.md, skills, and toggles.
sidebar:
  order: 4
---

See the [skills guide](/guides/skills-and-resources/) for how to add and enable resources.

## Context resources

Nerve loads `<project>/AGENTS.md`, then the `AGENTS.md` of each folder from the project root down to the conversation's working directory. Files above the project and in sibling folders are not read, and there is no user-level `AGENTS.md`: for guidance in every project, use a user skill or a user lead profile.

Nerve-specific project resources live under `.nerve/`: `.nerve/APPEND_SYSTEM.md` adds text to the system prompt for that project only. User-level Nerve resources such as skills and agent profiles live under `<NERVE_HOME>/agent/` (normally `~/.nerve/agent/`). `SYSTEM.md` files are not read.

## Skills

Effective skill discovery is first-name-wins in this order:

1. project `.nerve/skills`;
2. `.agents/skills` from project/ancestors according to project discovery order;
3. global `<NERVE_HOME>/agent` skills;
4. global `~/.agents/skills`;
5. enabled Built-in Nerve skills;
6. enabled Agent Browser skill guidance.

Within each skills root, Nerve recursively discovers `SKILL.md`, accepts direct root `.md` files, and honors `.gitignore`, `.ignore`, and `.fdignore`. Skills require a description; directory-based names must match their parent directory and use lowercase letters, digits, and single hyphens. Invalid files are omitted with diagnostics. `disable-model-invocation: true` keeps a skill out of model-visible discovery while preserving explicit application use.

Built-in Nerve and Agent Browser skills are disabled by default. The built-in **Forge** profile requires `configure-nerve`. A disabled skill contributes neither metadata nor instructions to the agent system prompt. Settings toggles do not delete source files, and changes apply to subsequent agent runs.

Project definitions therefore take precedence over global, built-in, and Agent Browser definitions with the same name. Built-in Nerve skills take precedence over same-named Agent Browser guidance. Inspect the Settings Skills view to see discovered scope and effective state.

## Toggles and defaults

Skills support per-source defaults (`file`, `nerve`, `agentBrowser`) and named exceptions. Within a layer, a named choice beats its source default; otherwise resolution continues to lower layers. File skills default on. Built-in Nerve and Agent Browser guidance default off unless scoped settings or an applied profile enable them. File skills override both, and Built-in Nerve skills override same-named Agent Browser guidance.

The User scope supplies defaults. The Project scope writes sparse, shareable overrides to `.nerve/config/agent.json`; a conversation's own choices live in that conversation's `config/agent.json`. Applied profile recommendations yield to conversation choices, and requirements control the effective value without overwriting them. Reset removes an editable override and inherits.

There are no configuration file watchers. Settings saves apply to the next prepared request. Manual edits need a restart or an explicit Reload or Retry. Child agents keep the preferences captured when they were created.

## Agent preference file

A project `config/agent.json` stores only its own choices:

```json
{
  "schemaVersion": 1,
  "revision": 0,
  "overrides": {
    "tools": {
      "web_search": { "enabled": true },
      "python_exec": { "enabled": false }
    },
    "skills": {
      "defaults": { "file": true, "nerve": false },
      "file": { "release": false },
      "nerve": { "engineering-docs": true },
      "agentBrowser": { "core": true }
    }
  }
}
```

Missing fields inherit. Tool configuration merges by declared fields. Accounts for Jira, Confluence, and Web Search are selected in extension settings (`extensions.json`, see [Extensions](/integrations/extensions/)); credentials are never copied into project or conversation files. Missing references stay visible with readiness diagnostics. See [Agent profiles](/reference/agent-profiles/) for requirements, health and repair, and scope paths.

Agent Browser skills are prompt guidance from an external CLI, not a native browser tool.

## Unsupported legacy paths

Legacy `.pi` directories are not loaded. Move Nerve-specific files into `.nerve/` and portable skills into `.agents/skills/`.

:::caution
Resources are model instructions. Review repository-controlled `AGENTS.md`, `APPEND_SYSTEM.md`, and skills before granting command, network, or autonomous authority. A project skill is not used until you approve it in Settings → Skills (the project column), where you see every file in its folder with scripts marked; any later change to the folder asks again.
:::
