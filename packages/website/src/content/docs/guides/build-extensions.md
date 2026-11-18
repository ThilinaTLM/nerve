---
title: Build an extension with Nerve
description: Ask the agent to build a file preview, page, side panel, theme, or integration, review what it asks for, allow it, and share it.
sidebar:
  order: 15
---

An extension adds to Nerve: a viewer for a file type, a page or side panel, a color theme, or tools and a Quick script namespace for a service. You describe what you want and the agent builds it with the built-in **configure-nerve** skill.

## Before you start

- **Node.js 24 or newer**, with npm or pnpm, on the computer running Nerve. If one is missing, the agent tells you how to install it.
- The **configure-nerve** skill is on by default; you can turn it off in **Settings → Skills**. See [Skills and project resources](/guides/skills-and-resources/).

## Ask the agent

Describe the result, and where it should live if you care:

> Build an extension that shows CSV files as a table. Keep it for me only.

The agent picks the kind, creates the project, writes and tests the code, builds it, and loads it. It asks only when your request leaves something open, such as whether the extension is for you or for the project.

| Where         | Folder                                                    | Available                                         |
| ------------- | --------------------------------------------------------- | ------------------------------------------------- |
| Yours         | `~/.nerve/agent/extensions/<id>/` (under your Nerve home) | In every project                                  |
| The project's | `<project>/.nerve/extensions/<id>/`                       | In that project, and for teammates once committed |

Color themes are always yours; a project can't add one.

## Review and allow

A new extension does nothing until you allow it. Open **Settings → Extensions**. It appears as **pending** with a plain-language list of what it asks for: websites it connects to, accounts it uses, file types it opens, tools it adds. Compare that with what you asked for, then choose **Allow**. The agent can't allow an extension for you.

Turn the extension on if its switch is off. Accounts and API tokens are added by you under **Accounts**, never in chat.

If the extension changes later and gains a permission, Nerve asks again and shows only what is new. See [Extensions](/integrations/extensions/) and [Extension locations and trust](/reference/extensions/).

## Change or upgrade it

Ask for the change in plain words: "make the table sort by column". The agent edits the extension in place, rebuilds, and reloads it. After a Nerve update that breaks extensions, the extension shows as **incompatible**; ask the agent to upgrade it.

## Share it

- **With your team:** build it as a project extension and commit the folder, including its `dist/` folder. Each teammate reviews and allows it on their own computer.
- **With one person:** send the folder without `node_modules/`. They put it in their own extensions folder and allow it.

Accounts and secrets are never part of the folder.

## For developers

The agent builds on the [`@nervekit/extension-sdk`](https://www.npmjs.com/package/@nervekit/extension-sdk) package, and you can use it directly. Its README covers the workflow, and the API is documented in the package's type declarations.
