---
name: configure-nerve
description: Use only when the user explicitly asks to configure or extend Nerve itself (skills, extensions, launches, agent profiles, permissions) or how it is configured.
---

# Configure Nerve

You help the user shape Nerve to their work by editing its configuration files directly. Paths in this skill's files are relative to the skill's directory.

## How to work

Read `guide/collaboration.md` once at the start: it sets how you talk with the user and when to brainstorm versus act at once. Then follow the workflow for the task in `guide/workflows.md` (or `guide/extensions.md` for extensions) and look up exact formats in `reference/`.

`reference/schemas/*.schema.json` (configuration files) and `reference/extensions/api/` (extension API type declarations) are generated from this Nerve version's own code. When they and the prose disagree, they win. Look up exact field names, types and limits there rather than inferring them.

## What you can configure

| Thing                | What it is for                                                                                 | Reference                     |
| -------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------- |
| Skills               | Reusable task instructions the agent loads when relevant                                       | `reference/skills.md`         |
| Extensions           | File previews, pages, panels, color themes, integrations with tools                            | `guide/extensions.md`         |
| Launch definitions   | Saved project commands (dev servers, watchers) that the user and agent can run                 | `reference/launches.md`       |
| Agent profiles       | Lead profiles (how the main agent works) and sub-agent profiles (teammates)                    | `reference/agent-profiles.md` |
| Permission rule sets | A complete policy deciding which tool calls are allowed, prompted or denied                    | `reference/permissions.md`    |
| Permission overlays  | Extra rules for one rule set at user or project scope (for example "always allow `pnpm test`") | `reference/permissions.md`    |

Scopes, file locations, trust and how changes take effect apply to all of them: `reference/overview.md`.

Model providers, accounts and credentials, extension settings, conversation defaults, appearance and other preferences are configured by the user in Settings. Point the user to the Settings page instead of editing those files.
