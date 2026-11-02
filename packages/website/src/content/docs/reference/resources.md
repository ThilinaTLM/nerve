---
title: Resource and skill precedence
description: Exact locations and precedence for AGENTS, SYSTEM, skills, and toggles.
sidebar:
  order: 4
---

See the [skills guide](/guides/skills-and-resources/) for how to add and enable resources.

## Context resources

Nerve loads global agent context and project/ancestor `AGENTS.md` files root-to-project. More local instructions augment or override through ordering as defined by the loader.

Nerve-specific project resources live under `.nerve/`. Global Nerve agent resources live under `<NERVE_HOME>/agent/` (normally `~/.nerve/agent/`). A project `SYSTEM.md` overrides the global system resource; append prompts from applicable scopes are concatenated.

## Skills

Effective skill discovery is first-name-wins in this order:

1. project `.nerve/skills`;
2. `.agents/skills` from project/ancestors according to project discovery order;
3. global `<NERVE_HOME>/agent` skills;
4. global `~/.agents/skills`;
5. enabled Built-in Nerve skills;
6. enabled Agent Browser skill guidance.

Within each skills root, Nerve recursively discovers `SKILL.md`, accepts direct root `.md` files, and honors `.gitignore`, `.ignore`, and `.fdignore`. Skills require a description; directory-based names must match their parent directory and use lowercase letters, digits, and single hyphens. Invalid files are omitted with diagnostics. `disable-model-invocation: true` keeps a skill out of model-visible discovery while preserving explicit application use.

Built-in Nerve and Agent Browser skills are disabled by default. A disabled skill contributes neither metadata nor instructions to the agent system prompt. Settings toggles do not delete source files, and changes apply to subsequent agent runs.

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
      "web_search": { "enabled": true, "profileId": "team-search" },
      "python_exec": { "enabled": false }
    },
    "skills": {
      "defaults": { "file": true, "nerve": false },
      "file": { "release": false },
      "nerve": { "skill-creator": true },
      "agentBrowser": { "core": true }
    }
  }
}
```

Missing fields inherit. Tool configuration merges by declared fields, except atomic values such as image generation settings. `profileId` selects a user-owned account only for Jira, Confluence, and Web Search; credentials are never copied into project or conversation files. Missing references stay visible with readiness diagnostics. See [Agent profiles](/reference/agent-profiles/) for requirements, health and repair, and scope paths.

Agent Browser skills are prompt guidance from an external CLI, not a native browser tool.

## Unsupported legacy paths

Legacy `.pi` directories are not loaded. Move Nerve-specific files into `.nerve/` and portable skills into `.agents/skills/`.

:::caution
Resources are model instructions. Review repository-controlled AGENTS, SYSTEM, and skills before granting command, network, or autonomous authority.
:::
