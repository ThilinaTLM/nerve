---
name: configure-nerve
description: Use when the user wants to set up or understand Nerve itself (project instructions, skills, prompt suggestions, extensions, launches, agent profiles and teammates, permissions), including complaints like "it keeps asking before running tests". Not for project code.
---

# Configure Nerve

You shape Nerve to the user's work by editing its configuration. Paths in this skill's files are relative to the skill's directory. `<home>` is the Nerve home and `<project>` the project directory; `configuration.describe()` gives both.

## How to work

- **One mechanism clearly fits and few details are missing** ("add a launch for `pnpm dev`", "allow `pnpm test` under Supervise"): do it, then report what you wrote and where. Ask only what the request leaves open and the project cannot tell you.
- **The mechanism itself is open** ("it keeps forgetting our conventions", "I want a reviewer"): pick candidates from the table below, read `guide/collaboration.md`, and settle it with the user before building.
- **Question** ("what is configured?", "why was that prompted?"): answer from the calls under "The loop". Offer a change only when it would help.

## Which mechanism

Candidates are listed cheapest first. Take the first that solves the problem.

| The user says                                      | Candidates                                                                            | Take the later one when                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| "It keeps forgetting our conventions"              | `AGENTS.md`, a skill, profile instructions                                            | A skill: the guidance is long or applies to one kind of task. Profile: it applies to one way of working only. |
| "It keeps asking before X"                         | An overlay rule                                                                       | —                                                                                                             |
| "I keep typing the same request"                   | A prompt suggestion, a skill                                                          | A skill: the request needs steps or files, not one prompt.                                                    |
| "I want it to work with service X"                 | An allow rule for a CLI that exists, a skill around the CLI, an integration extension | Extension: there is no CLI, or calls need accounts, typed operations or their own permission rules.           |
| "I want a second opinion on changes"               | A sub-agent profile, a lead profile                                                   | Lead profile: the user wants to talk to the reviewer directly.                                                |
| "It should work differently for this kind of work" | A lead profile, a rule set                                                            | Rule set: the difference is what may run without asking.                                                      |
| "I want to see or open X in Nerve"                 | A preview, page or panel extension                                                    | —                                                                                                             |
| "Start my dev server"                              | A launch definition                                                                   | —                                                                                                             |

## What you can configure

| Thing                | User scope: every project, works at once    | Project scope: shared through the repository                  | Default scope                                     | Reference                         |
| -------------------- | ------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| Project instructions | none (a user-level `AGENTS.md` is not read) | `<project>/AGENTS.md` and folders below                       | project                                           | `reference/agents-md.md`          |
| Skills               | `<home>/agent/skills/<name>/`               | `<project>/.nerve/skills/<name>/` (user approves)             | user for a personal skill, project for a team one | `reference/skills.md`             |
| Prompt suggestions   | `<home>/agent/suggestions/<name>.md`        | `<project>/.nerve/suggestions/<name>.md`                      | project                                           | `reference/prompt-suggestions.md` |
| Launch definitions   | none                                        | `launches.*` calls                                            | project                                           | `reference/launches.md`           |
| Agent profiles       | `<home>/agent/agent-profiles/<name>.json`   | `<project>/.nerve/agent-profiles/<name>.json` (user approves) | user for a personal one                           | `reference/agent-profiles.md`     |
| Permission rule sets | `<home>/config/rule-sets/<id>.json`         | none                                                          | user                                              | `reference/permissions.md`        |
| Permission overlays  | `<home>/config/permissions.json`            | `<project>/.nerve/config/permissions.json` (user approves)    | user for a personal rule                          | `reference/permissions.md`        |
| Agent preferences    | `<home>/config/agent.json`                  | `<project>/.nerve/config/agent.json` (user approves)          | edit only on an exact request                     | `reference/agent-profiles.md`     |
| Extensions           | `<home>/agent/extensions/<id>/`             | `<project>/.nerve/extensions/<id>/` (user consents)           | user                                              | `guide/extensions.md`             |

Choose project scope for what the team should share, and name in your hand-over the approval the user must give. Choose user scope for what is personal: it works without approval.

Model providers, accounts and credentials, extension settings, conversation defaults and appearance are the user's in Settings. Point them to the page instead of editing those files. A conversation's own files under `<home>/data/conversations/` are managed by Nerve; do not edit them.

## Precedence and approval

- Same name: project wins over user, user over built-in. A project profile or skill replaces the lower one whole; nothing is merged.
- Agent preferences: built-in, then user, then project, then the conversation's own choices; a later layer overrides single fields. A profile's requirements win over all of them.
- Project files that can run code or widen what agents may do are used only after the user approves their exact content: permission overlays, agent profiles and `agent.json` in Settings → This project → Trust; skills in Project settings → Skills; a suggestion's `enable-js` in Settings → Suggestions; extensions in Settings → Extensions.
- Any edit to an approved file, including yours, asks again. You cannot approve, consent or add credentials.

## The loop

Nerve does not watch files. In `quick_script`:

1. **Read what is in effect.** `configuration.describe()` (rule set, model, applied profile), `configuration.list({ kind })` (what exists, after precedence, with `state`), `configuration.tools.list()` (tool names as rules match them), `configuration.explain({ tool, args })` (why a call is allowed or prompted). `sdk.describe("configuration")` has the result shapes.
2. **Write.** Read an existing file in full first and keep what you did not mean to change. Before editing a file under `<home>` (usually not in git), copy it next to itself as `<name>.bak` and name the copy in your reply. Before a permission change, say in one sentence what will be allowed, prompted or denied afterwards, unless the user dictated the rule.
3. **Check.** `configuration.check("project")` or `("user")` validates the files on disk and changes nothing. Fix what it reports until it returns no resource with an `error`.
4. **Reload.** `configuration.reload(scope)` activates the files.
5. **Hand over.** Report what you wrote with paths, and exactly what `configuration.list({ state: "needs_approval" })` shows, with where the user approves each.

```ts
const checked = await configuration.check("project");
if (
  checked.resources.some((r) => r.diagnostics.some((d) => d.level === "error"))
)
  return checked;
return await configuration.reload("project");
```

What a returned resource means:

| `state`                                     | Meaning                                                                        | You                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `invalid`                                   | Not in use.                                                                    | Fix it, check again.                                          |
| `active` with `previousVersionActive: true` | The file on disk is invalid; the version loaded before your edit stays in use. | Fix it and reload. Nothing is broken yet.                     |
| `needs_approval`                            | Valid, and not used until the user approves it.                                | Tell the user where (`approval.where`).                       |
| `active` with `warning` diagnostics         | In use, and probably not doing what was meant.                                 | Read the message; fix it or tell the user why it is intended. |
| `shadowed`                                  | Another resource with the same name wins.                                      | Rename it or remove one.                                      |

Leave no `error` behind when you end your turn. After a restart there is no loaded version to fall back to, and an invalid permission file or preferences that select a missing rule set then block every tool call.

Kinds that need more than the loop: launches are written with `launches.*`, then started with the `launch` tool (`reference/launches.md`); extensions are built and checked with `nerve-ext` (`guide/extensions.md`).

`reference/schemas/*.schema.json` are generated from this Nerve version. Open one only for a diagnostic you cannot resolve from its message.
