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

First definition by skill name wins. Effective discovery favors project Nerve skills and ancestor portable project skills, then global Nerve and global portable skills, enabled Built-in Nerve skills, and finally enabled Agent Browser guidance. Disabled definitions are removed before precedence is resolved. Review the exact [resource precedence table](/reference/resources/) when two definitions share a name.

Use **Settings → Skills** to inspect discovered scope and toggle a skill without deleting its file. The **Built-in Nerve skills** group contains official guidance shipped with Nerve. Built-in skills are disabled by default and add nothing to the system prompt until enabled. The initial `skill-creator` skill helps create valid project or user skills.

The **User** scope supplies defaults. The **Project** scope writes sparse, shareable overrides to `.nerve/config/agent.json`; conversation choices live in that conversation's `config/agent.json`. Applied profile recommendations yield to conversation choices; requirements control the effective value without overwriting those choices. Source labels explain the result. **Reset removes an editable override and inherits**, even if its value currently equals a default.

Skills support per-source defaults (`file`, `nerve`, `agentBrowser`) and named boolean exceptions. Within a layer, a named choice wins over its source default; otherwise resolution continues to lower layers. File skills default on; Built-in Nerve and Agent Browser guidance default off, unless scoped settings or an applied profile contribute otherwise.

There are no configuration file watchers. UI saves publish directly for the next prepared request; manual edits need restart for guaranteed activation or an explicit Reload/Retry re-read. Changes do not rewrite an already-prepared provider request. Child agents retain their captured creation preferences rather than inheriting subsequent lead/default edits.

## Agent preference file format

A project `config/agent.json` stores only its choices:

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

Missing fields inherit. Tool configuration merges by declared fields, except atomic values such as image generation settings. `profileId` selects a user-owned account only for Jira, Confluence and Web Search; credentials are never copied into project or conversation files. Missing references remain visible with readiness diagnostics, not silently replaced. Retired capability/harness formats are converted during migration, not read as runtime alternatives. See [Agent profiles](/reference/agent-profiles/) for requirements, health/repair and full scope paths.

## Trust

Skills and context files are instructions supplied to the model. A repository can contain instructions that ask for tools, credentials, network calls, or destructive actions. Review unfamiliar resources before increasing permission beyond supervised.

Built-in Nerve and Agent Browser skills are appended only when enabled by effective settings or an applied profile. File skills override both, and Built-in Nerve skills override same-named Agent Browser guidance. Agent Browser skills are prompt guidance from an external CLI, not a native browser automation tool.

## Next steps

- [Resource reference](/reference/resources/)
- [Agent Browser integration](/integrations/agent-browser/)
- [Security model](/operations/security/)
