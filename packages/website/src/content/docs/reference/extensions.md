---
title: Extension locations and trust
description: Where Nerve looks for extensions, which one wins, what consent covers, and when an extension stops loading.
sidebar:
  order: 5
---

How to build one is in [Build an extension with Nerve](/guides/build-extensions/). Built-in extensions are described in [Extensions](/integrations/extensions/). The extension API is documented in the type declarations of [`@nervekit/extension-sdk`](https://www.npmjs.com/package/@nervekit/extension-sdk).

## Locations and precedence

| Source   | Folder                                                     | Scope         |
| -------- | ---------------------------------------------------------- | ------------- |
| Project  | `<project>/.nerve/extensions/<id>/`                        | That project  |
| User     | `<NERVE_HOME>/agent/extensions/<id>/` (default `~/.nerve`) | Every project |
| Built-in | Ships with Nerve                                           | Every project |

The folder name is the extension's id. Only the `dist/` folder inside it is read. When two sources have the same id, the project one wins, then the user one; the other shows as **shadowed**. An extension can't reuse a built-in's id.

Extensions that add a file preview, page, or side panel apply to the project they are used in. Color themes come only from user extensions.

## Trust

- Nothing in an extension runs until you allow it in **Settings → Extensions**. The review lists what it asks for, and your approval covers exactly the files you reviewed.
- A **project** extension asks again after any change to its files. A **user** extension keeps your approval through code-only changes and asks again when it gains a permission, a file type to open, a tool, or another contribution; the review shows only what is new.
- You can withdraw approval at any time. The on/off switch is separate from approval: approval decides whether the extension loads, the switch whether it is used.
- Extension code runs in a sandbox with no file system access of its own. It reaches only the websites and accounts it declared, and it never sees your account secrets. Panels and pages run in isolated frames without network access.
- When the agent uses an extension's tools, the usual [permission rules](/guides/agent-controls/) apply to those actions.

## States and compatibility

| State            | Meaning                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Pending approval | Valid, waiting for you to review and allow it.                                           |
| Enabled          | Loaded.                                                                                  |
| Incompatible     | Built for a different Nerve version than this one supports; ask the agent to upgrade it. |
| Invalid          | Failed validation; the extension page lists why.                                         |
| Shadowed         | Another source has the same id.                                                          |

An extension loads on the Nerve version it was built with or a newer one, until a Nerve release changes the extension interface.
