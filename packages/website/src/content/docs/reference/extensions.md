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

Extensions that add a file preview, page tab, or dock panel apply to the project they are used in. Color themes come only from user extensions; a project extension's themes are ignored.

## Trust

- Nothing in an extension runs until you allow it in **Settings → Extensions**. The review lists what it asks for, and your approval covers exactly the files you reviewed.
- The review also lists the sign-in an extension performs (OAuth 2.0, or its own code, called out as broad access), the sign-in websites and scopes it asks for, and, for an extension that uses a platform's accounts, "Uses your github accounts with scopes ...".
- A **project** extension asks again after any change to its files. A **user** extension keeps your approval through code-only changes and asks again when it gains a permission, a file type to open, a tool, or another contribution, or when its sign-in code changes; the review shows only what is new.
- You can withdraw approval at any time. The on/off switch is separate from approval: approval decides whether the extension loads, the switch whether it is used.
- Extension code runs in a sandbox with no file system access of its own. It reaches only the websites and accounts it declared, and it never sees your account credentials. An extension that signs in with its own code (for request signing or token exchanges) runs that code in a separate sandbox; changing it asks you to allow the extension again. Panels and pages run in isolated frames without network access.
- When the agent uses an extension's tools, the usual [permission rules](/guides/agent-controls/) apply to those actions.

## What an extension can declare

| Part                     | Notes                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings                 | A typed schema that generates the extension's Settings page. Field types include text, choices, accounts, and model choices (`model`, `imageModel`) |
| Accounts                 | Account kinds with fields, secrets, how they are sent, and a provider: typed-in secrets, OAuth 2.0, or the extension's own credential code          |
| `quick_script` namespace | Methods with a declared risk, operation name, and targets, so [permission rules](/guides/agent-controls/) apply to them                             |
| Direct tools             | Optional tools for the one or two actions the model needs often                                                                                     |
| UI contributions         | At most 16 each of file previews, page tabs, dock panels, and themes                                                                                |
| Permissions              | Network origins, model services (`text`, `vision`, `image`), and frame services (`chat.startConversation`)                                          |

Each network origin, model service, and frame service is a line in the consent review, and broad grants (`*` network access, custom file editing, an extension's own credential code) are called out.

- **Model calls** name a model explicitly. The host accepts only a model the user chose in one of the extension's own model settings, or, for text and vision, the default model; any other value is denied. Images pass as file handles read under the call's declared reads, and generated images are saved as artifacts.
- **Starting conversations.** With `chat.startConversation` declared, a panel or page can start a conversation from a click, with the prompt unsent if it asks for that. The model, profile, and rule set it names are the extension's own settings of that type.
- **Accounts** can be user-level or project-level, are encrypted at rest, and are refreshed by a background job. An extension's credential code can't reach the network except its declared sign-in origins; an OAuth loopback redirect path, if needed, is declared in the manifest. See [Accounts](/integrations/extensions/#accounts).
- **Per-project data.** An extension can keep its own data per project, shared between its backend and its frames. It stays on your computer, isn't part of the extension folder, and is deleted with the project.
- **UI frames** have no network or file access of their own. The host draws menus, pickers, and confirmations over the frame, and the SDK provides Nerve's components, including floating toolbars.

The full API is in the type declarations of [`@nervekit/extension-sdk`](https://www.npmjs.com/package/@nervekit/extension-sdk), which re-exports the public `@nervekit/extension-api`.

## States and compatibility

| State           | Meaning                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Pending consent | Valid, waiting for you to review and allow it, or changed since you allowed it. Nothing runs.                        |
| Enabled         | Loaded.                                                                                                              |
| Incompatible    | Built with an SDK newer than this Nerve supports, or older than the oldest it supports; ask the agent to upgrade it. |
| Invalid         | Failed validation, for example a text over its limit or a built-in id reused; the extension page lists why.          |
| Shadowed        | Another source has the same id.                                                                                      |

A folder that has no `dist/manifest.json` isn't built yet. The extension page says so, and a Forge conversation can build it; Nerve never builds or installs an extension by itself. Extensions are loaded or re-read when you choose **Reload** on the Extensions page, or when the agent reloads them; Nerve doesn't watch the folders. The `@nervekit/extension-sdk` version equals Nerve's version, so extensions built for an older release may need the SDK upgraded after you update.
