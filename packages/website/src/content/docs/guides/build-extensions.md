---
title: Build an extension with Nerve
description: Ask the agent to build a file preview, page, side panel, theme, or integration, review what it asks for, allow it, and share it.
sidebar:
  order: 15
---

An extension adds to Nerve: a viewer for a file type, a page tab or dock panel, a color theme, or tools and a Quick script namespace for a service. You describe what you want and the agent builds it with the built-in **configure-nerve** skill. It is part of the wider [configure by chat](/guides/configure-by-chat/) workflow.

<!-- screenshot: forge-build -->

| Kind          | What it adds                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------- |
| `preview`     | A viewer for file types you choose, optionally with editing                                  |
| `page`        | A tab not tied to a file, such as a dashboard                                                |
| `panel`       | A dock panel beside the conversation                                                         |
| `theme`       | A color theme (yours only; a project can't add one)                                          |
| `integration` | A Quick script namespace and optional tools for a service, with accounts for its credentials |

One extension can combine kinds. For example, a side panel that shows whether your QA and production environments are up combines a `panel` with an `integration` that makes the checks.

## Before you start

- **Node.js 24 or newer**, with npm or pnpm, on the computer running Nerve. If one is missing, the agent tells you how to install it.
- Select the **Forge** profile in the composer (or `/profile forge`); it turns on the **configure-nerve** skill. You can also enable the skill in **Settings → Skills**. See [Skills and project resources](/guides/skills-and-resources/).

## Ask the agent

Describe the result, and where it should live if you care:

> Build an extension that shows CSV files as a table. Keep it for me only.

The agent picks the kind, creates the project with `nerve-ext init`, writes and tests the code, builds it, and reloads it. It asks only when your request leaves something open, such as whether the extension is for you or for the project.

| Where         | Folder                                                    | Available                                         |
| ------------- | --------------------------------------------------------- | ------------------------------------------------- |
| Yours         | `~/.nerve/agent/extensions/<id>/` (under your Nerve home) | In every project                                  |
| The project's | `<project>/.nerve/extensions/<id>/`                       | In that project, and for teammates once committed |

Color themes are always yours; a project can't add one.

## Review and allow

A new extension does nothing until you trust it. Open **Settings → Extensions**. It appears as **Needs review** with a plain-language list of what it asks for: websites it connects to, accounts it uses, file types it opens, tools it adds. Compare that with what you asked for, then choose **Trust**. The agent can't trust an extension for you.

Turn the extension on if its switch is off. Accounts and API tokens are added by you on the extension's page or under **Accounts**, never in chat. An extension can sign in with static keys or OAuth 2.0 (see [Accounts](/integrations/extensions/#accounts)).

If the extension changes later and gains a permission, Nerve asks again and shows only what is new. See [Extensions](/integrations/extensions/) and [Extension locations and trust](/reference/extensions/).

## Change or upgrade it

Ask for the change in plain words: "make the table sort by column". The agent edits the extension in place, rebuilds, and reloads it. After a Nerve update that breaks extensions, the extension shows as **Incompatible**, and the bell offers **Ask the agent to upgrade**; the agent upgrades the SDK and rebuilds.

## Share it

- **With your team:** build it as a project extension and commit the sources and lockfile. `dist/` and `node_modules/` stay out of git. A teammate who pulls it sees that it isn't built and asks the agent in a Forge conversation to install and build it, then reviews and allows it on their own computer.
- **With one person:** send the sources without `node_modules/` and `dist/`. They put the folder in their own extensions folder, ask the agent to build it, and allow it.

Accounts and secrets are never part of the folder.

## For developers

The agent builds on the [`@nervekit/extension-sdk`](https://www.npmjs.com/package/@nervekit/extension-sdk) package, and you can use it directly. It is the one dependency of an extension project: the extension API, test helpers, UI components, and the `nerve-ext` build tool.

```sh
npx @nervekit/extension-sdk init csv-viewer --kind integration
cd csv-viewer && npm install --ignore-scripts
npx nerve-ext check
```

| Command                                 | Does                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `nerve-ext init <id> --kind <kind>[,…]` | Scaffolds one or more of `preview`, `page`, `panel`, `theme`, `integration`    |
| `nerve-ext build`                       | Bundles the backend and UI frames into `dist/` and writes `dist/manifest.json` |
| `nerve-ext check`                       | Type-checks, builds, validates, and runs the tests                             |
| `nerve-ext test` / `nerve-ext dev`      | Runs the tests; rebuilds `dist/` when sources change                           |

Install with `--ignore-scripts`; Nerve never builds or installs an extension itself. The SDK shares Nerve's version and channels: the default install matches stable Nerve, and `@nervekit/extension-sdk@next` matches the [staging channel](/start/install/#release-channels). The package README covers the workflow, its `UPGRADING.md` the changes between versions, and the API is documented in the package's type declarations. [Extension locations and trust](/reference/extensions/) describes what the host enforces.
