---
title: Resource and skill precedence
description: Exact locations and precedence for AGENTS, SYSTEM, skills, and toggles.
sidebar:
  order: 4
---

## Context resources

Nerve loads global agent context and project/ancestor `AGENTS.md` files root-to-project. More local instructions augment or override through ordering as defined by the loader.

Nerve-specific project resources live under `.nerve/`. Global Nerve agent resources live under `<NERVE_HOME>/agent/` (normally `~/.nerve/agent/`). A project `SYSTEM.md` overrides the global system resource; append prompts from applicable scopes are concatenated.

## Skills

Effective skill discovery is first-name-wins in this order:

1. project `.nerve/skills`;
2. `.agents/skills` from project/ancestors according to project discovery order;
3. global `<NERVE_HOME>/agent` skills;
4. global `~/.agents/skills`;
5. enabled Agent Browser skill guidance, only when no file skill already won that name.

Settings toggles remove disabled names without deleting source files. Changes apply to subsequent agent runs.

Project definitions therefore take precedence over global definitions with the same name. Inspect the Settings Skills view to see discovered scope and effective state.

## Unsupported legacy paths

Legacy `.pi` directories are not loaded. Move Nerve-specific files into `.nerve/` and portable skills into `.agents/skills/`.

:::caution
Resources are model instructions. Review repository-controlled AGENTS, SYSTEM, and skills before granting command, network, or autonomous authority.
:::
