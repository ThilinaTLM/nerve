# Build or change an extension

An extension is a folder with a built `dist/`. Nerve loads it only after the user allows it in Settings → Extensions. You can never grant that consent; your own actions on the extension (writing files, running scripts, reloading) go through the normal permission engine.

## 1. Prerequisites

Node.js 24 or newer and npm (or pnpm). `scripts/create-extension.mjs` checks them and prints how to install what is missing; relay that to the user instead of installing system software yourself.

## 2. Agree the design with the user

Read `reference/extensions/overview.md` first: it maps the parts, the sandboxes and the sign-in options. A new extension is a design the user lives with (where it shows, what it may reach, what they must sign in to), so settle it before you scaffold. Ask with one `ask_user` call that batches the open questions, each with options and your recommendation. Skip a question only when the user's words already answer it; a default is not an answer.

- **Scope.** `user`: `${NERVE_HOME:-$HOME/.nerve}/agent/extensions/<id>/`, in every project, keeps its consent through code-only changes. `project`: `<project>/.nerve/extensions/<id>/`, shared with the team through the repository as sources (`dist/` stays out of git; teammates build it), and asks for consent again after any change. Project extensions cannot contribute themes. Recommend `user` for a personal tool, `project` for one the team should get.
- **Where it shows.** A panel beside the conversation, a page in its own tab, a preview of a file type, or agent access only (script namespace, direct tool). Describe each in the user's terms ("a panel next to the chat that lists your tasks") and recommend one.
- **Sign-in**, when the service needs an account: typed-in key, standard OAuth, or the extension's own sign-in code (shown to the user as broad access). Ask before reading the user's local credential or tool configuration to find out how they sign in, and recommend the simplest option that works for them.
- **Reach**, when it is not obvious: read-only, or also changes (writes, deletes) in the service.

Then choose without asking:

- **Kind.** The `--kind` values of the chosen parts: `preview`, `page`, `panel`, `theme`, `integration` (namespace and direct tools), comma-separated in one extension (`integration,panel`).
- **Id.** Lowercase letters, digits and single hyphens (`csv-viewer`); it is also the folder name. Tool names must start with the id with underscores and `_` (`csv_viewer_get`), and account kinds with the id; the build and Nerve reject others.

## 3. Scaffold

```sh
node scripts/create-extension.mjs <id> --kind <kind>[,<kind>] --scope <user|project> [--project <dir>]
```

The script writes the project, installs dependencies without running install scripts (`--ignore-scripts`) and runs `nerve-ext check`. Each kind adds a working sample to replace, with tests beside it:

| Path                                         | Holds                                                     |
| -------------------------------------------- | --------------------------------------------------------- |
| `src/extension.ts`                           | The definition only; it wires the parts below             |
| `src/backend/`                               | `namespace.ts` and one file per method                    |
| `src/previews/`, `src/pages/`, `src/panels/` | One folder per contribution: its Svelte entry and helpers |
| `src/themes/<id>.json`                       | Theme tokens                                              |
| `docs/`                                      | Doc topics listed in the namespace's `docs`               |

Install further dependencies with `npm install --ignore-scripts <name>`. Read `src/extension.ts` and the sample before changing them. Rename the sample folders and ids to fit the feature; keep the layout when you add contributions.

## 4. Implement with least permissions

Declare only what the feature needs: network origins, model services, frame services, accounts. Each one is shown to the user as a line they must accept; broad ones (`*` network, custom editing of files) are called out. Read the references you need, not all of them:

- What to read for which part: `reference/extensions/overview.md`
- Exact API (every type, option, default and limit), and where to start reading it: `reference/extensions/api.md`
- Definition decisions, text limits, states: `reference/extensions/manifest.md`
- Backend (`ctx`, risks, `authorize`, errors, tests): `reference/extensions/backend.md`
- Previews, pages, panels, bridge, components: `reference/extensions/ui.md`
- Layout and components that match Nerve (read before writing any frame): `reference/extensions/ui-patterns.md`; every component and its props: `reference/extensions/components.md`
- Themes: `reference/extensions/themes.md`
- What to put in front of the user: `reference/extensions/security.md`

## 5. Check

Run `npx nerve-ext check` (or `pnpm exec nerve-ext check`) in the extension folder until it passes: type check, build and validation, tests. Errors name the file, the problem and the fix. Add tests for logic and for each backend method's `parse` and `authorize`. During iteration `nerve-ext dev` rebuilds `dist/` on change (run it in the background).

## 6. Reload and read the status

```ts
await extensions.reload("<id>"); // re-reads the folder; never grants consent
return await extensions.status("<id>");
```

Nerve loads a new or changed extension folder only on `extensions.reload`. `configuration.check("user")` (or `"project"`) reads the folders on disk and reports a folder that is valid but not loaded yet as `reload-needed`. When a user and a project extension share an id, `configuration.list({ kind: "extension" })` shows both with their scope and which one is shadowed.

`status` returns `state`, `consent`, `switch`, `diagnostics` and `recentErrors` (since the last reload: backend exceptions, plus uncaught frame errors and CSP violations with `operation: "frame:<kind>/<id>"`; console output is not included). A frame only runs once the user has allowed the extension and opened it, so after they try it, read the status again before you say it works. Fix every `error` diagnostic, run `check`, and reload again. Expected end state for a new extension: `state: "pending_consent"`, `consent: "needs_review"`.

## 7. Hand over to the user

Tell the user to open Settings → Extensions, review what the extension asks for, and choose Allow. Name what you declared (network origins, accounts, file types, tools) so they can compare it with the review. After consent, `extensions.status` shows `consent: "granted"` (`"declined"` if they declined: mention it only if it matters, and do not ask them to reverse it); if `switch` is `"off"`, ask the user to turn the extension on there. Do not ask for credentials in chat: accounts are added by the user in Settings.

A user extension keeps its consent through code-only changes. It asks again when it gains a permission or UI contribution; reload after such a change and tell the user what is new.

## Change an existing extension

Edit the sources in its folder (not `dist/`), then run steps 5 to 7. Work in place when the user says "change my X extension": find it with `extensions.status("<id>")` (its `folder`) and keep the id. Built-in extensions (`source: "builtin"`) are not editable; create a new extension instead.

## Upgrade after a Nerve update

Find the extensions with `configuration.list({ kind: "extension" })` (`path` is the folder; `state: "incompatible"` needs an upgrade). An extension built with an SDK older than this Nerve's `oldestCompatibleSdkVersion`, or newer than this Nerve, is `incompatible` ("Built with SDK …") and does not load. Upgrade one then or when the user asks. Folders under the Nerve home are outside the project, so run commands there with `cd <folder> && …` in the command and leave the shell tool's `cwd` unset:

```sh
node scripts/upgrade-extension.mjs <extension-folder>
```

It moves `@nervekit/extension-sdk` to this Nerve's version, prints the `UPGRADING.md` sections between the old and new versions (none when nothing broke), and runs `check`, which rebuilds `dist/`. Apply each printed change, run `check` until green, reload, and read the status.

## Share

`reference/extensions/sharing.md`: moving between user and project scope, sharing sources, building a folder someone else made.

## A folder you did not scaffold in this conversation

A folder that arrived from a teammate, a repository or the user shows `not-built` (no `dist/`). Its `package.json` can pull in any package. Before installing:

```sh
node scripts/install-extension.mjs <extension-folder> --list
```

Show the user the dependency list it prints and wait for their go-ahead. Then run the same command without `--list`: it installs with the folder's lockfile and without install scripts, and runs `nerve-ext check`. A dependency's code still runs during the build and the tests.
