# Launch definitions

A launch definition is a saved project command: a dev server, test watcher, build or any long-running process. The user runs it from the Launches panel; the agent runs it with the `launch` tool by name. Each run is a separate process with its own output.

Use a launch for a process someone starts repeatedly. A one-off command does not need one.

## Write it with `launches`

In quick_script, `launches` changes the catalog through Nerve itself: `list()`, `create({ label, command, cwd, port, runPolicy, folder, before })`, `update({ id, ... })` (omitted fields stay, `null` clears `label`, `cwd` or `port`), `remove(id)`, `folders.create({ label, folder, before })` and `move({ id, folder, before })`. Ids, timestamps and `order` are filled in, and the rules below are applied for you. Never edit `definitions.json` by hand when `launches` can do the change. The file format below is for reading it and for repairing it when `launches` says it is invalid.

## File

Project scope only: `<project>/.nerve/launches/definitions.json`. There is no user-scope catalog. A missing file is an empty catalog. Nerve reads the file on every use, so no reload is needed.

```json
{
  "version": 2,
  "folders": [
    {
      "id": "launchfolder_dev",
      "label": "Dev",
      "parentFolderId": null,
      "order": 0
    }
  ],
  "definitions": [
    {
      "id": "launchdef_web",
      "label": "Web dev server",
      "command": "pnpm dev",
      "cwd": "packages/web",
      "port": 5173,
      "runPolicy": "single",
      "createdAt": "2026-01-15T09:00:00.000Z",
      "updatedAt": "2026-01-15T09:00:00.000Z",
      "scope": { "kind": "project" },
      "parentFolderId": "launchfolder_dev",
      "order": 0
    }
  ]
}
```

## Fields

Exact shape: `reference/schemas/launch-definitions.schema.json`. The cross-file rules below cannot be expressed in the schema.

Top level: `version` (always `2`), `folders` and `definitions` (both required arrays). Unknown keys anywhere make the file invalid.

Definition:

| Field                    | Required | Value                                                                                                                                              |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | yes      | Starts with `launchdef_`; unique in the file. Use a readable suffix (`launchdef_web`).                                                             |
| `label`                  | no       | Display name and the name used by the `launch` tool. Non-empty, no leading/trailing spaces.                                                        |
| `command`                | yes      | Shell command, not blank.                                                                                                                          |
| `cwd`                    | no       | Working directory, relative to the project directory. Defaults to the project directory. Prefer relative paths; absolute ones break for teammates. |
| `port`                   | no       | Integer 1–65535; the port the process serves, shown to the user.                                                                                   |
| `runPolicy`              | no       | `"single"` (default; one run at a time) or `"concurrent"`.                                                                                         |
| `createdAt`, `updatedAt` | yes      | ISO date-time; use the current time, and update `updatedAt` when you change a definition.                                                          |
| `scope`                  | yes      | Exactly `{ "kind": "project" }`.                                                                                                                   |
| `parentFolderId`         | yes      | A folder `id`, or `null` for the top level.                                                                                                        |
| `order`                  | yes      | Position among siblings (see below).                                                                                                               |

There is no field for environment variables; put them in the command (`PORT=3000 pnpm dev`).

Folder: `id` (starts with `launchfolder_`), `label` (non-empty, trimmed), `parentFolderId` (folder `id` or `null`), `order`. Folders only organize; they pass no settings to their definitions.

## Rules checked across the file

- Ids are unique across folders and definitions.
- Every `parentFolderId` names an existing folder, and folders do not form cycles.
- Within one parent, the `order` values of all its children (folders and definitions together) are exactly `0, 1, …, n-1`. Renumber the siblings when you insert or remove an entry.
- Sibling folder labels are unique, ignoring case.

## Names

The `launch` tool finds a definition by its name: the `label`, or the command when there is no label. Two definitions with the same name make the name ambiguous, so give each a distinct label. Folder placement does not affect the name.

## Repairing the file

If `launches` fails because the file is invalid, fix the file by hand: read it in full, keep entries you did not mean to change, then run `configuration.check("project")` until it is clean. Nerve will not overwrite an invalid file.

Changing a definition does not affect runs already in progress; the next run uses the new command.

To confirm a new definition works, start it with the `launch` tool, read its logs, and stop it if the user did not ask for it to keep running.
