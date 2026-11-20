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

Any edit to such a file, including yours, withdraws the approval until the user approves the new content. Until then the file is ignored (overlays) or unavailable (profiles). User-scope files need no trust. Skills and launch definitions need no trust.

## Apply changes

Nerve does not watch files. After you edit configuration by hand:

- Skills: read again from the next agent run. Launch definitions: read again on next use.
- Agent profiles, permission files and agent preferences: cached until reloaded. Reload and read the result; it also reports an invalid launch catalog:

```ts
return await configuration.reload("project"); // or "user"
```

`configuration.status(scope)` returns the same result without reloading; use it to inspect the current state before a change.

The result is `{ diagnostics }`; an empty list means every file of that scope loads. Each diagnostic has `scope`, `document` (`agent.json`, `conversation-defaults`, `profile:<name>`, `permissions.json`, `rule-set:<id>`, `launches`), `path`, `level`, `code` and a `message` that says what is wrong and what to do. `level: "error"` means the file is not in use. Project files waiting for the user's approval have `code: "untrusted"` at `level: "warning"`; only the user can clear those. Rule sets are checked with user scope, the launch catalog with project scope. Skills are not covered.

An invalid permission file blocks tool calls (model replies still work), so fix every `error` diagnostic before ending your turn, and reload again. Reloading never approves trust.

## Failure behavior to keep in mind

- Invalid JSON or a schema violation makes the whole file invalid; unknown keys are rejected everywhere.
- Invalid permission overlay (user or project) or an invalid selected rule set: tool calls are blocked until it is fixed.
- Invalid launch catalog: the catalog reads as empty and cannot be edited in the app until fixed.
- Invalid profile: that profile is unavailable; a broken project profile does not fall back to the user or built-in one with the same name.
