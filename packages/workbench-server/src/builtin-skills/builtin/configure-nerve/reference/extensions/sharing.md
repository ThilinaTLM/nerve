# Sharing, locations and updates

An extension is one self-contained folder; `dist/` is what Nerve reads.

| Location | Path                                                 | Use                                                            |
| -------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| User     | `${NERVE_HOME:-$HOME/.nerve}/agent/extensions/<id>/` | Yours, in every project. Can contribute themes.                |
| Project  | `<project>/.nerve/extensions/<id>/`                  | Shared through the repository, available in that project only. |

If both have the same id, the project one wins and the user one shows as `shadowed`. A built-in id cannot be reused.

`extensionStore` data is kept by the daemon under the extension id, not in the folder: it survives moving the extension between scopes and removing it, is deleted with the project, and is never shared through the repository.

## Share with a team (project scope)

1. Create it with `--scope project`, or move the folder to `<project>/.nerve/extensions/<id>/`.
2. Commit `dist/` together with the sources. Teammates do not build; Nerve reads `dist/` only. `create-extension.mjs` warns when git ignores `dist/`; fix it with `!.nerve/extensions/*/dist/` in `.gitignore`. Keep `node_modules/` out of git.
3. Each teammate sees it as pending and reviews and allows it themselves in Settings → Extensions. A project extension asks again after any change to its files.

## Share with a person

Send the folder without `node_modules/`, after `nerve-ext check` has produced `dist/`. The receiver copies it to their user folder (or a project's `.nerve/extensions/`), reloads in Settings → Extensions, and reviews it. Accounts and secrets are never part of the folder; the receiver adds their own.

## Updates

Rebuild with `nerve-ext check`, bump `version` in `package.json` for releases, and reload. After a Nerve update that breaks extensions, `extensions.status` shows `incompatible`; run `scripts/upgrade-extension.mjs`. An extension is built with the SDK of the Nerve that created or upgraded it. It loads on that Nerve version or newer, until a Nerve release changes the extension API; it then needs the upgrade script.
