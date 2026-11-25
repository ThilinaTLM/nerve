# Extensions at a glance

A map of what an extension can do and which file explains each part. Read it once per extension task, then open only the files the feature needs. Exact types: `reference/extensions/api.md`.

## What the user gets

Choose one or more parts with the user (`guide/extensions.md`, step 2). They map to `--kind` of the scaffold.

| Part             | The user sees                                                                | Fits                                                                           | Kind          | Read                                                                          |
| ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------- |
| Panel            | A dock panel beside the conversation, like Git or Files                      | Status to keep in view while chatting: a list to watch, a queue, a checklist   | `panel`       | `reference/extensions/ui.md`, `reference/extensions/ui-patterns.md` ("Panel") |
| Page             | A tab of its own, opened from the new-tab menu                               | A dashboard, a board, a settings-like form, anything that needs the full width | `page`        | `reference/extensions/ui.md`, `reference/extensions/ui-patterns.md` ("Page")  |
| Preview          | A file opens in the extension's view instead of the source                   | A file format (CSV table, diagram, log viewer), optionally editable            | `preview`     | `reference/extensions/ui.md` ("Editing in previews")                          |
| Theme            | Colors in Settings → Theme (user scope only)                                 | Appearance                                                                     | `theme`       | `reference/extensions/themes.md`                                              |
| Script namespace | Nothing; agents call `<namespace>.<method>()` in `quick_script`              | Agent access to a service, combinable in scripts                               | `integration` | `reference/extensions/backend.md`                                             |
| Direct tool      | A tool the agent calls without a script, optionally with its own result card | The one or two calls agents need most often                                    | `integration` | `reference/extensions/backend.md` ("Direct tools")                            |

A service integration is usually a namespace, plus a panel or page when the user also wants to see the data. Frames get their data from the extension's own methods (`host.backend.call`).

## Where code runs

|               | Backend (`src/extension.ts`, methods)                      | Credential provider (`src/credentials.ts`)                                            | Frame (preview, page, panel)                             |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Runtime       | QuickJS sandbox, no Node.js built-ins or timers            | Its own QuickJS sandbox per operation, no timers                                      | Sandboxed browser frame with an opaque origin            |
| Network       | `ctx.http` to `permissions.network` only                   | `ctx.http` to `signInOrigins` only, in `signIn`, `refresh`, `revoke`; none in `apply` | None: call a backend method                              |
| Credentials   | Never sees them; `auth` on a request adds them             | Sees the account's secrets and state                                                  | Never sees them                                          |
| Asks the user | Never; Nerve asks for approval from `risk` and `authorize` | `ctx.ui` during `signIn`                                                              | `host.ui` (menus, pickers, confirm, notify) from a click |
| Keeps data    | `ctx.store`                                                | The `state` it returns; the host encrypts it                                          | `host.store`, `host.tabState`                            |
| Read          | `reference/extensions/backend.md`                          | `reference/extensions/backend.md` ("An account kind")                                 | `reference/extensions/ui.md`                             |

## Accounts and sign-in

The user adds accounts in Settings → Accounts; the extension declares an account kind and an `account` setting that selects one. Take the first row that fits:

| The service signs in with                                                                  | Declare                                     | Code you write                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------ |
| A token, password or API key the user types in                                             | `secret` or `secrets`, and `auth`           | None                                                   |
| Standard OAuth 2.0 (authorization code or device code)                                     | `provider: { type: "oauth2", ... }`         | None                                                   |
| Anything else: request signing (AWS SigV4), a token exchange, SSO with a loopback redirect | `provider: "extension"` and `signInOrigins` | `src/credentials.ts`; the user sees it as broad access |
| Accounts another extension already defines                                                 | `uses: [{ platform }]`                      | None                                                   |

Credential code has no timers, so it cannot poll; use `ctx.ui.loopback` for a browser redirect, or the `oauth2` provider for device-code flows. Details: `reference/extensions/backend.md` ("An account kind"); types: `AccountKindData` in `reference/extensions/api/extension-api/settings.d.ts`, `defineCredentialProvider` in `reference/extensions/api/extension-api/credentials.d.ts`.

## UI components

`@nervekit/extension-sdk/ui` exports Nerve's own UI kit and every Lucide icon. Build from it rather than raw elements so frames match Nerve in every theme.

- Which component for which need, and the layouts of panels, pages and floating toolbars: `reference/extensions/ui-patterns.md`.
- Every component with its description, props and declaration file: `reference/extensions/components.md` (generated from this Nerve version).
- What frames cannot use (dialogs, dropdowns, toasts, forms, network) and what replaces it: `reference/extensions/ui.md` ("Not allowed in frames").

## Examples and tests

In a scaffolded project the SDK is at `node_modules/@nervekit/extension-sdk/`. Read files there by path; the folder can be a symlink, which `find` does not follow without `-L`.

- Each kind's scaffold sample, with its tests, is the starting point.
- `examples/aws-sigv4/`: an account kind whose requests are signed in `apply` (typed-in AWS keys).
- `examples/github-app/`: a credential provider that exchanges a signed JWT for a token in `signIn` and `refresh`.

Test helpers come from `@nervekit/extension-sdk/testing`:

| Test                                         | Helper                                                                 | Declared in                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| Backend methods: `parse`, `authorize`, `run` | `createFakeContext`                                                    | `reference/extensions/api/extension-api/testing.d.ts`       |
| Credential operations                        | `createFakeCredentialContext`; scripted `http` and `ui`, no `loopback` | `reference/extensions/api/extension-api/testing.d.ts`       |
| Frames                                       | `createFakeBridge`, with Svelte's `mount`                              | `reference/extensions/api/extension-sdk/frame/testing.d.ts` |

## Other topics

| Topic                                                                          | Read                               |
| ------------------------------------------------------------------------------ | ---------------------------------- |
| Definition decisions, icons, agent-facing text limits, states                  | `reference/extensions/manifest.md` |
| What the user reviews before allowing it, least privilege                      | `reference/extensions/security.md` |
| User or project scope, sharing, updates                                        | `reference/extensions/sharing.md`  |
| Writing namespace summaries, method doc comments, tool descriptions and errors | `reference/writing-for-agents.md`  |
