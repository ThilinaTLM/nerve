# Build or change an extension

An extension is a folder with a built `dist/`. Nerve loads it only after the user allows it in Settings → Extensions. You can never grant that consent; your own actions on the extension (writing files, running scripts, reloading) go through the normal permission engine.

## 1. Prerequisites

Node.js 24 or newer and npm (or pnpm). `scripts/create-extension.mjs` checks them and prints how to install what is missing; relay that to the user instead of installing system software yourself.

## 2. Decide scope and kind

Ask one focused question only when the request does not settle these.

- **Scope.** `user`: `${NERVE_HOME:-$HOME/.nerve}/agent/extensions/<id>/`, available in every project. `project`: `<project>/.nerve/extensions/<id>/`, shared through the repository (commit `dist/`, since teammates do not build). Project extensions cannot contribute themes.
- **Kind.** `preview` (render a file type), `page` (a tab not tied to a file), `panel` (a dock panel), `theme` (colors), `integration` (a `quick_script` namespace and direct tools for a service). Combine kinds the feature needs in one extension, comma-separated (`integration,panel`).
- **Id.** Lowercase letters, digits and single hyphens (`csv-viewer`); it is also the folder name.

## 3. Scaffold

```sh
node scripts/create-extension.mjs <id> --kind <kind>[,<kind>] --scope <user|project> [--project <dir>]
```

The script writes the project, installs dependencies and runs `nerve-ext check`. Each kind adds a working sample to replace, with tests beside it:

| Path                                         | Holds                                                     |
| -------------------------------------------- | --------------------------------------------------------- |
| `src/extension.ts`                           | The definition only; it wires the parts below             |
| `src/backend/`                               | `namespace.ts` and one file per method                    |
| `src/previews/`, `src/pages/`, `src/panels/` | One folder per contribution: its Svelte entry and helpers |
| `src/themes/<id>.json`                       | Theme tokens                                              |
| `docs/`                                      | Doc topics listed in the namespace's `docs`               |

Read `src/extension.ts` and the sample before changing them. Rename the sample folders and ids to fit the feature; keep the layout when you add contributions.

## 4. Implement with least permissions

Declare only what the feature needs: network origins, capabilities, accounts. Each one is shown to the user as a line they must accept; broad ones (`*` network, custom editing of files) are called out. Read the references you need, not all of them:

- Exact API (every type, option, default and limit), and where to start reading it: `reference/extensions/api.md`
- Definition decisions, text limits, states: `reference/extensions/manifest.md`
- Backend (`ctx`, risks, `authorize`, errors, tests): `reference/extensions/backend.md`
- Previews, pages, panels, bridge, components: `reference/extensions/ui.md`
- Themes: `reference/extensions/themes.md`
- What to put in front of the user: `reference/extensions/security.md`

## 5. Check

Run `npx nerve-ext check` (or `pnpm exec nerve-ext check`) in the extension folder until it passes: type check, build and validation, tests. Errors name the file, the problem and the fix. Add tests for logic and for each backend method's `parse` and `authorize`. During iteration `nerve-ext dev` rebuilds `dist/` on change (run it in the background).

## 6. Reload and read the status

```ts
await extensions.reload("<id>"); // re-reads the folder; never grants consent
return await extensions.status("<id>");
```

`status` returns `state`, `consent`, `switch`, `diagnostics` and `recentErrors` (since the last reload: backend exceptions, plus uncaught frame errors and CSP violations with `operation: "frame:<kind>/<id>"`; console output is not included). A frame only runs once the user has allowed the extension and opened it, so after they try it, read the status again before you say it works. Fix every `error` diagnostic, run `check`, and reload again. Expected end state for a new extension: `state: "pending_consent"`, `consent: "pending"`.

## 7. Hand over to the user

Tell the user to open Settings → Extensions, review what the extension asks for, and choose Allow. Name what you declared (network origins, accounts, file types, tools) so they can compare it with the review. After consent, `extensions.status` shows `consent: "granted"`; if `switch` is `"off"`, ask the user to turn the extension on there. Do not ask for credentials in chat: accounts are added by the user in Settings.

A user extension keeps its consent through code-only changes. It asks again when it gains a permission or UI contribution; reload after such a change and tell the user what is new.

## Change an existing extension

Edit the sources in its folder (not `dist/`), then run steps 5 to 7. Work in place when the user says "change my X extension": find it with `extensions.status("<id>")` (its `folder`) and keep the id. Built-in extensions (`source: "builtin"`) are not editable; create a new extension instead.

## Upgrade after a Nerve update

When `status` says the extension is `incompatible` ("Built with SDK …"), or the user asks to upgrade:

```sh
node scripts/upgrade-extension.mjs <extension-folder>
```

It moves `@nervekit/extension-sdk` to this Nerve's version, prints the `UPGRADING.md` sections between the old and new versions, and runs `check`. Apply each printed change, run `check` until green, reload, and read the status.

## Share

`reference/extensions/sharing.md`: moving between user and project scope, committing `dist/`, giving a folder to someone else.
