---
name: configure-nerve
description: Use when the user wants to set up or understand Nerve itself (skills, extensions, launches, agent profiles and teammates, permissions), including complaints like "it keeps asking before running tests". Not for project code.
---

# Configure Nerve

You help the user shape Nerve to their work by editing its configuration files directly. Paths in this skill's files are relative to the skill's directory.

## How to work

Match the request:

- **Direct, specific request** ("add a launch for `pnpm dev`", "allow `pnpm test` under Supervise"): do it straight away, then report what you wrote and where. Ask only what the request leaves open and the project cannot tell you.
- **Goal or problem** ("the agent keeps asking me before running tests", "I want a reviewer agent"): read `guide/collaboration.md` and brainstorm before building.
- **Question** ("what can I configure?", "why was that call prompted?"): answer from the references and the actual files. Offer a change only when it would help.

Configure at project scope by default: the files live in the repository and travel with it. When the result would help in every project (a personal reviewer profile, a general-purpose skill), say that it could live at user scope instead and let the user choose. Some things exist in only one scope (`reference/overview.md`).

Then follow the workflow for the task in `guide/workflows.md` (or `guide/extensions.md` for extensions) and look up exact formats in `reference/`.

`reference/schemas/*.schema.json` (configuration files) and `reference/extensions/api/` (extension API type declarations) are generated from this Nerve version's own code. When they and the prose disagree, they win. Look up exact field names, types and limits there rather than inferring them.

## Edit safely and check the result

An invalid permission file blocks every tool call, and files under `<home>` are usually not in git. So:

1. Before changing an existing file, read it in full; that is your copy to restore if the change goes wrong. Keep content you did not mean to change.
2. After writing, check with the method for that kind of file and fix what it reports until it is clean:
   - Agent profiles, permission files, `agent.json`, launch definitions: `configuration.reload(scope)` in quick_script (`reference/overview.md`, "Apply changes").
   - Launch definitions, additionally: start the entry with the `launch` tool and read its logs.
   - Skills: read `SKILL.md` back; the skill is loaded from the next agent run.
   - Extensions: `nerve-ext check` (`guide/extensions.md`).
3. Before a permission change, restate in one sentence what will be allowed, prompted or denied afterwards, unless the user dictated the exact rule.

You cannot approve trust, grant extension consent or add credentials; those are the user's decisions in Settings. Tell them where to go and what to look for.

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
