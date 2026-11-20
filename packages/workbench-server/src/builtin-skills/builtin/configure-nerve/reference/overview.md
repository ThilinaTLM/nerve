# Configuration overview

## Homes

- **Nerve home** (`<home>`): `$NERVE_HOME` when set, otherwise `~/.nerve`. Check the environment variable rather than assuming; dev instances use another home.
- **Project** (`<project>`): the conversation's project directory. Nerve-specific project files live in `<project>/.nerve/`.

## Where each thing lives

| Thing                | User scope (every project)                                                | Project scope (shared through the repository)                                         |
| -------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Skills               | `<home>/agent/skills/<name>/SKILL.md`, `~/.agents/skills/<name>/SKILL.md` | `<project>/.nerve/skills/<name>/SKILL.md`, `<project>/.agents/skills/<name>/SKILL.md` |
| Extensions           | `<home>/agent/extensions/<id>/`                                           | `<project>/.nerve/extensions/<id>/`                                                   |
| Launch definitions   | none                                                                      | `<project>/.nerve/launches/definitions.json`                                          |
| Agent profiles       | `<home>/agent/agent-profiles/<name>.json`                                 | `<project>/.nerve/agent-profiles/<name>.json`                                         |
| Permission rule sets | `<home>/config/rule-sets/<id>.json`                                       | none                                                                                  |
| Permission overlays  | `<home>/config/permissions.json`                                          | `<project>/.nerve/config/permissions.json`                                            |
| Agent preferences    | `<home>/config/agent.json`                                                | `<project>/.nerve/config/agent.json`                                                  |

Agent preferences (`agent.json`) hold the default model, thinking level, rule set selection, tool and skill toggles. The user changes them in Settings; read them to understand the current setup, and edit them only when the user asks for exactly that change. Their fields are the settings object described in `reference/agent-profiles.md` ("Settings object"), wrapped as `{ "schemaVersion": 1, "revision": <n>, "overrides": { ... } }`. Keep `revision` as it is.

Exact shape of `agent.json`: `reference/schemas/agent-preferences.user.schema.json` and `reference/schemas/agent-preferences.project.schema.json`. The project file also carries a top-level `"version": 2`; keep it.

A conversation also has its own `agent.json` and `permissions.json` under `<home>/data/conversations/<id>/config/`. Nerve manages them; do not edit them.

## Precedence

- Skills, extensions and profiles with the same name: project wins over user, user over built-in. A project profile replaces the whole lower definition; nothing is merged.
- Agent preferences: built-in, then user, then project, then the conversation's own choices; a later layer overrides single fields.
- Permissions: see `reference/permissions.md` ("How a decision is made").

## Trust

Some project files can run code or widen what agents may do, so Nerve uses them only after the user approves their exact content in **Settings → This project → Trust**:

- project permission overlays (`.nerve/config/permissions.json`);
- project agent profiles (`.nerve/agent-profiles/*.json`);
- project extensions, which also need consent in **Settings → Extensions**.

Any edit to such a file, including yours, withdraws the approval until the user approves the new content. Until then the file is ignored (overlays) or unavailable (profiles). User-scope files need no trust. Launch definitions need no trust. A project skill needs the user's approval of its folder (`reference/skills.md`).

## See what is in effect

Ask Nerve instead of inferring from files. In `quick_script`:

| Call                                            | Gives                                                                                                                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configuration.describe()`                      | Project directory, `<home>`, the selected rule set and what selected it, the model, the applied profile and the settings it locks, the models a setting may name.                                          |
| `configuration.list({ kind?, scope?, state? })` | Everything configured after precedence: profiles, rule sets, overlays, the launch catalog, skills, prompt suggestions, extensions, with `state`. `{ state: "needs_approval" }` is what waits for the user. |
| `configuration.tools.list()`                    | Every tool as rules match it: exact name, groups, base risk, primary arguments. Take `toolNames` and `toolGroups` from here; they are case-sensitive.                                                      |
| `configuration.explain({ tool, args })`         | The decision the active policy gives that call and the rule that decides. Runs nothing.                                                                                                                    |

## Apply changes

Nerve does not watch files. After you edit configuration by hand:

- Skills: read again from the next agent run. Launch definitions: read again on next use; change them with `launches.*`, not by hand.
- Agent profiles, permission files and agent preferences: cached until reloaded. Check the files on disk, fix what is reported, then reload:

```ts
const checked = await configuration.check("project"); // or "user"; changes nothing
if (checked.resources.length > 0) return checked;
return await configuration.reload("project");
```

Both return `{ resources }`: only the files that have a diagnostic, so an empty list means every file of that scope is valid. Each resource has `kind`, `id`, `scope`, `path`, `state` and `diagnostics` (`level`, `code`, `message`, `pointer`); the message says what is wrong and what to do.

| `state`                                     | Meaning                                                                                                                                                           | You                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `invalid`                                   | The file is not in use.                                                                                                                                           | Fix it, check again.                                              |
| `active` with `previousVersionActive: true` | The file on disk is invalid, so the version loaded before your edit stays in use.                                                                                 | Fix it and reload; nothing is broken yet.                         |
| `needs_approval`                            | The file is valid and ignored until the user approves its exact content.                                                                                          | Tell the user where (`approval.where`). You cannot approve.       |
| `active` with only `warning` diagnostics    | The file is in use and probably does not do what was meant: a tool name that matches nothing, a rule set id that does not exist, an `allow` on every `bash` call. | Read the message and fix it, or tell the user why it is intended. |

Rule sets are covered by user scope, the launch catalog by project scope. Skills, prompt suggestions and extensions are covered too: a skill with broken frontmatter, a skill hidden by another of the same name, a suggestion whose predicate waits for approval, an extension that is invalid or waits for consent.

Preferences that select a rule set which does not exist are treated like an invalid file, because they would block every tool call.

Leave no `error` diagnostic behind when you end your turn: after a restart there is no loaded version to fall back to, and an invalid permission file then blocks tool calls (model replies still work). Reloading never approves trust.

## Failure behavior to keep in mind

- Invalid JSON or a schema violation makes the whole file invalid; unknown keys are rejected everywhere.
- Invalid permission overlay (user or project) or an invalid selected rule set: the version loaded before the edit stays in use. With none loaded (after a restart), tool calls are blocked until it is fixed.
- Invalid launch catalog: the catalog reads as empty and cannot be edited in the app until fixed.
- Invalid profile: that profile is unavailable; a broken project profile does not fall back to the user or built-in one with the same name.
