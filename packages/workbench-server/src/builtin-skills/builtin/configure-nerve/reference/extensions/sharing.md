# Sharing, locations and updates

An extension is one self-contained folder; `dist/` is what Nerve reads.

| Location | Path                                                 | Use                                                            |
| -------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| User     | `${NERVE_HOME:-$HOME/.nerve}/agent/extensions/<id>/` | Yours, in every project. Can contribute themes.                |
| Project  | `<project>/.nerve/extensions/<id>/`                  | Shared through the repository, available in that project only. |

If both have the same id, the project one wins and the user one shows as `shadowed`. A built-in id cannot be reused.

`ctx.store` data is kept by the daemon under the extension id, not in the folder: it survives moving the extension between scopes and removing it, is deleted with the project, and is never shared through the repository.

## Share with a team (project scope)

1. Create it with `--scope project`, or move the folder to `<project>/.nerve/extensions/<id>/`.
2. Commit the sources and the lockfile; the scaffold's `.gitignore` keeps `dist/` and `node_modules/` out of git. Nerve never builds or installs by itself.
3. A teammate who pulls it sees `not-built`. They ask the agent to build it: it follows "A folder you did not scaffold in this conversation" in `reference/extensions/build.md` (list the dependencies, wait, then `reference/extensions/scripts/install-extension.mjs`).
4. They review and allow it themselves in Settings → Extensions. A project extension asks again after any change to its files.

## Share with a person

Send the sources without `node_modules/` and `dist/`. The receiver copies the folder to their user folder (or a project's `.nerve/extensions/`) and asks the agent to build it, as above; then they reload in Settings → Extensions and review it. Accounts and secrets are never part of the folder; the receiver adds their own.

## Updates

Rebuild with `nerve-ext check`, bump `version` in `package.json` for releases, and reload. An extension built with an SDK newer than this Nerve, or older than its `oldestCompatibleSdkVersion`, is `incompatible` in `extensions.status` and does not load; run `reference/extensions/scripts/upgrade-extension.mjs`, which upgrades the SDK and rebuilds.
