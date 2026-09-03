---
title: Load skills and project resources
description: Add reusable instructions and understand discovery, precedence, and toggles.
sidebar:
  order: 12
---

Nerve builds each agent run from global and project resources. Resources apply to subsequent runs; changing a file does not rewrite an already-sent provider request.

## Context and system instructions

Nerve loads global agent `AGENTS.md`, then files from ancestors root-to-project. A project `SYSTEM.md` overrides the global system resource. Global and project append prompts are concatenated where defined.

Project-specific Nerve resources live under `.nerve/`. Portable shared agent skills live in `.agents/skills/` in the project or its ancestors. Global Nerve agent resources live under `<NERVE_HOME>/agent/`; global portable skills live under `~/.agents/skills/`.

Legacy `.pi` directories are not loaded.

## Skill files and discovery

Nerve recursively discovers `SKILL.md` files below each configured skills directory. It also accepts Markdown files placed directly at that directory's root. `.gitignore`, `.ignore`, and `.fdignore` rules are honored while walking.

A skill needs a nonempty `description`. A directory-based skill's lowercase, hyphenated name must match its parent directory; invalid files are skipped and surfaced as diagnostics. Nerve gives the model each discoverable skill's name, description, and location, then reads the full file only when the skill is used. Set `disable-model-invocation: true` when a skill should remain available for explicit application use without being advertised to the model.

## Skill precedence

First definition by skill name wins. Effective discovery favors project Nerve skills and ancestor portable project skills before global Nerve and global portable skills. Disabled names are removed. Review the exact [resource precedence table](/reference/resources/) when two definitions share a name.

Use **Settings → Skills** to inspect discovered scope and toggle a skill without deleting its file.

## Trust

Skills and context files are instructions supplied to the model. A repository can contain instructions that ask for tools, credentials, network calls, or destructive actions. Review unfamiliar resources before increasing permission beyond supervised.

Agent Browser skills are appended only when explicitly enabled and cannot override file skills. They are prompt guidance from an external CLI, not a native browser automation tool.

## Next steps

- [Resource reference](/reference/resources/)
- [Agent Browser integration](/integrations/agent-browser/)
- [Security model](/operations/security/)
