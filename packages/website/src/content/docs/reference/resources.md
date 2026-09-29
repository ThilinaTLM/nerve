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
5. enabled Built-in Nerve skills;
6. enabled Agent Browser skill guidance.

Within each skills root, Nerve recursively discovers `SKILL.md`, accepts direct root `.md` files, and honors `.gitignore`, `.ignore`, and `.fdignore`. Skills require a description; directory-based names must match their parent directory and use lowercase letters, digits, and single hyphens. Invalid files are omitted with diagnostics. `disable-model-invocation: true` keeps a skill out of model-visible discovery while preserving explicit application use.

Built-in Nerve and Agent Browser skills are disabled by default. A disabled skill contributes neither metadata nor instructions to the agent system prompt. Settings toggles do not delete source files, and changes apply to subsequent agent runs.

Project definitions therefore take precedence over global, built-in, and Agent Browser definitions with the same name. Built-in Nerve skills take precedence over same-named Agent Browser guidance. Inspect the Settings Skills view to see discovered scope and effective state.

## Richdoc builtin

The optional `richdoc` skill produces polished, browser-readable HTML documents using semantic HTML and a small component vocabulary. Like every builtin, it is disabled by default; enable it explicitly in Settings Skills.

Richdoc is self-contained: its instructions, bundled Node CLI, rendering assets and examples ship together. The agent invokes its absolute `scripts/richdoc.mjs` path through the normal shell tool. Node 24+ is required; Python, uv, npm installation and a global CLI are not. Its commands prepare local assets, validate documents and describe components.

Documents open directly in a browser with their accompanying asset directory. Diagrams (Mermaid), math, code highlighting, charts and curated icons render locally without external requests. There are no export commands, book framework or embedded trusted-app HTML preview. Validation checks authoring correctness, not security isolation.

## Unsupported legacy paths

Legacy `.pi` directories are not loaded. Move Nerve-specific files into `.nerve/` and portable skills into `.agents/skills/`.

:::caution
Resources are model instructions. Review repository-controlled AGENTS, SYSTEM, and skills before granting command, network, or autonomous authority.
:::
